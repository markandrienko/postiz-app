import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { Integration } from '@prisma/client';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import {
  AuthTokenDetails,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { TemporalService } from 'nestjs-temporal-core';

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
    await this._integrationService.refreshNeeded(
      integration.organizationId,
      integration.id
    );

    await this._integrationService.informAboutRefreshError(
      integration.organizationId,
      integration,
      socialProvider.refreshErrorMessage?.(refreshError) || cause
    );
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
      if (refreshError) {
        console.error(
          `Could not refresh ${integration.providerIdentifier} integration ${integration.id}`,
          refreshError?.response?.data || refreshError?.message || refreshError
        );
      }

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
