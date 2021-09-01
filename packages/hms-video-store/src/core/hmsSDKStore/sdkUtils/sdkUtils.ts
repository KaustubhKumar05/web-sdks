import { HMSTrack, HMSRemoteAudioTrack, HMSRemoteVideoTrack } from '@100mslive/hms-video';

export function isRemoteTrack(track: HMSTrack) {
  return track instanceof HMSRemoteAudioTrack || track instanceof HMSRemoteVideoTrack;
}