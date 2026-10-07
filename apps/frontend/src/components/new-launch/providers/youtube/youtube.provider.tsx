'use client';

import { FC } from 'react';
import {
  PostComment,
  withProvider,
} from '@gitroom/frontend/components/new-launch/providers/high.order.provider';
import { YoutubeSettingsDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/youtube.settings.dto';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';
import { Input } from '@gitroom/react/form/input';
import { MediumTags } from '@gitroom/frontend/components/new-launch/providers/medium/medium.tags';
import { MediaComponent } from '@gitroom/frontend/components/media/media.component';
import { Select } from '@gitroom/react/form/select';
import { YoutubePreview } from '@gitroom/frontend/components/new-launch/providers/youtube/youtube.preview';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
const type = [
  {
    label: 'Public',
    value: 'public',
  },
  {
    label: 'Private',
    value: 'private',
  },
  {
    label: 'Unlisted',
    value: 'unlisted',
  },
];

const madeForKids = [
  {
    label: 'No',
    value: 'no',
  },
  {
    label: 'Yes',
    value: 'yes',
  },
];
const YoutubeSettings: FC = () => {
  const { register, control } = useSettings();
  const t = useT();
  return (
    <div className="flex flex-col">
      <Input label="Title" {...register('title')} maxLength={100} />
      <div className="text-[14px] mb-[18px] text-balance">
        {t(
          'youtube_description_from_post',
          'The post text is used as the video description on YouTube.'
        )}
      </div>
      <Select
        label="Type"
        {...register('type', {
          value: 'public',
        })}
      >
        {type.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </Select>
      <Select
        label="Made for kids"
        {...register('selfDeclaredMadeForKids', {
          value: 'no',
        })}
      >
        {madeForKids.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </Select>
      <MediumTags label="Tags" {...register('tags')} />
      <div className="mt-[20px]">
        <MediaComponent
          type="image"
          width={1280}
          height={720}
          label="Thumbnail"
          description="Thumbnail picture (optional)"
          {...register('thumbnail')}
        />
      </div>
      {/* Required notice: YouTube API Services Terms of Service, section 9.1 */}
      <div className="bg-tableBorder p-[10px] mt-[20px] rounded-[10px] text-[13px] text-balance">
        {t(
          'youtube_upload_terms_notice_1',
          "By clicking 'upload,' you certify that the content you are uploading complies with the YouTube Terms of Service (including the YouTube Community Guidelines) at"
        )}{' '}
        <a
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#B69DEC] hover:underline"
          href="https://www.youtube.com/t/terms"
        >
          https://www.youtube.com/t/terms
        </a>
        .{' '}
        {t(
          'youtube_upload_terms_notice_2',
          "Please be sure not to violate others' copyright or privacy rights."
        )}
      </div>
    </div>
  );
};
export default withProvider({
  postComment: PostComment.COMMENT,
  comments: false,
  minimumCharacters: [],
  SettingsComponent: YoutubeSettings,
  CustomPreviewComponent: YoutubePreview,
  dto: YoutubeSettingsDto,
  maximumCharacters: 5000,
});
