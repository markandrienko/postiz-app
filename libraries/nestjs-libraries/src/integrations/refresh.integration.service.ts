import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { Integration } from '@prisma/client';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import {
  AuthTokenDetails,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { TemporalService } from 'nestjs-temporal-core';
import { timer } from '@gitroom/helpers/utils/timer';

@Injectable()
export class RefreshIntegrationService {
  constructor(
    private _integrationManager: IntegrationManager,
    @Inject(forwardRef(() => IntegrationService))
    private _integrationService: IntegrationService,
    private _temporalService: TemporalService
  ) {}
  async refresh(integration: Integration, cause = ''): Promise<false | AuthTokenDetails> {
    const socialProvider = this._integrationManager.getSocialIntegration(
      integration.providerIdentifier
    );

    const refresh = await this.refreshProcess(integration, socialProvider, cause);

    if (!refresh) {
      return false as const;
    }

    await this._integrationService.createOrUpdateIntegration(
      undefined,
      !!socialProvider.oneTimeToken,
      integration.organizationId,
      integration.name,
      integration.picture!,
      'social',
      integration.internalId,
      integration.providerIdentifier,
      refresh.accessToken,
      refresh.refreshToken,
      refresh.expiresIn
    );

    return refresh;
  }

  // Data retention (periodicDataRefresh platforms): the same token refresh as
  // refresh(), but it also stores the account's current name, picture and
  // username, which refresh() keeps unchanged. A failed refresh - or a token
  // refresh that works for an account that can't reach the channel any more
  // (reConnect) - only marks the channel as disconnected (and notifies) when
  // the provider reports the access as gone (refreshErrorRevoked), never on a
  // temporary error, and never again for a channel already marked (`silent`).
  async refreshAccountData(
    integration: Integration,
    silent = false
  ): Promise<false | AuthTokenDetails> {
    const socialProvider = this._integrationManager.getSocialIntegration(
      integration.providerIdentifier
    );
    const accessGone = (err: any) =>
      !silent && !!socialProvider.refreshErrorRevoked?.(err);

    let refresh: false | AuthTokenDetails;
    try {
      refresh = await this.refreshProcess(
        integration,
        socialProvider,
        '',
        accessGone
      );
    } catch (err) {
      // refreshProcess throws when reConnect fails after a working token
      // refresh (or on a database error); anything but a gone channel is
      // retried by the next run
      if (!accessGone(err)) {
        throw err;
      }

      await this.markDisconnected(integration, socialProvider, err);
      return false as const;
    }

    if (!refresh) {
      return false as const;
    }

    await this._integrationService.saveRefreshedAccountData(
      integration,
      refresh
    );

    return refresh;
  }

  public async setBetweenSteps(integration: Integration, cause = '') {
    await this._integrationService.setBetweenRefreshSteps(integration.id);
    await this._integrationService.informAboutRefreshError(
      integration.organizationId,
      integration,
      cause
    );
  }

  public async startRefreshWorkflow(orgId: string, id: string, integration: SocialProvider) {
    if (!integration.refreshCron) {
      return false;
    }

    return this._temporalService.client
      .getRawClient()
      ?.workflow.start(`refreshTokenWorkflow`, {
        workflowId: `refresh_${id}`,
        args: [{integrationId: id, organizationId: orgId}],
        taskQueue: 'main',
        workflowIdConflictPolicy: 'TERMINATE_EXISTING',
      });
  }

  private async markDisconnected(
    integration: Integration,
    socialProvider: SocialProvider,
    refreshError: any,
    cause = ''
  ) {
    // informAboutRefreshError (with the failure cause) already notifies
    // the user, and refreshNeeded sets the same flag disconnectChannel
    // would — calling disconnectChannel here sent a second, cause-less
    // copy of the same email for every failed refresh.
    // A channel that is already flagged keeps failing on every later
    // refresh attempt (e.g. hourly analytics polling of an expired token),
    // so only the attempt that flagged it notifies.
    const flagged = await this._integrationService.refreshNeeded(
      integration.organizationId,
      integration.id
    );

    if (flagged) {
      await this._integrationService.informAboutRefreshError(
        integration.organizationId,
        integration,
        socialProvider.refreshErrorMessage?.(refreshError) || cause
      );
    }
  }

  private async refreshProcess(
    integration: Integration,
    socialProvider: SocialProvider,
    cause = '',
    // whether a failed refresh marks the channel as disconnected and notifies
    shouldNotify: (refreshError: any) => boolean = () => true
  ): Promise<AuthTokenDetails | false> {
    let refreshError: any = undefined;
    const refresh: false | AuthTokenDetails = await socialProvider
      .refreshToken(integration.refreshToken)
      .catch((err) => {
        refreshError = err;
        return false as const;
      });

    if (!refresh || !refresh.accessToken) {
      // Two flows can refresh the same channel at once (two posts, a post and
      // analytics). A provider that replaces the refresh token on every refresh
      // rejects the second one while the first is still storing its tokens:
      // wait for them and reuse them instead of flagging the channel.
      for (let attempt = 0; attempt < 3; attempt++) {
        const stored = await this._integrationService.getIntegrationById(
          integration.organizationId,
          integration.id
        );
        if (
          !stored ||
          stored.refreshNeeded ||
          stored.inBetweenSteps ||
          stored.deletedAt
        ) {
          break;
        }
        if (
          stored.internalId === integration.internalId &&
          stored.providerIdentifier === integration.providerIdentifier &&
          stored.refreshToken &&
          stored.refreshToken !== integration.refreshToken &&
          stored.token !== integration.token &&
          stored.tokenExpiration &&
          stored.tokenExpiration.getTime() > Date.now()
        ) {
          return {
            id: stored.internalId,
            name: stored.name,
            username: stored.profile || '',
            picture: stored.picture || '',
            accessToken: stored.token,
            refreshToken: stored.refreshToken,
            expiresIn: Math.floor(
              (stored.tokenExpiration.getTime() - Date.now()) / 1000
            ),
          };
        }
        if (attempt < 2) {
          await timer(1000 * (attempt + 1));
        }
      }

      console.error(
        `Could not refresh ${integration.providerIdentifier} integration ${integration.id}`,
        refreshError?.response?.data ||
          refreshError?.message ||
          refreshError ||
          'no access token returned'
      );

      if (!shouldNotify(refreshError)) {
        return false;
      }

      await this.markDisconnected(
        integration,
        socialProvider,
        refreshError,
        cause
      );

      return false;
    }

    if (
      !socialProvider.reConnect ||
      integration.rootInternalId === integration.internalId
    ) {
      return refresh;
    }

    let reConnect;
    try {
      reConnect = await socialProvider.reConnect(
        integration.rootInternalId,
        integration.internalId,
        refresh.accessToken
      );
    } catch (err: any) {
      console.error(
        `Could not reconnect ${integration.providerIdentifier} integration ${integration.id} after a successful token refresh`,
        err?.response?.data || err?.message || err
      );
      throw err;
    }

    return {
      ...refresh,
      ...reConnect,
    };
  }
}
