import { HMSAudioCodec, HMSVideoCodec } from '../interfaces';
import {
  HMSAudioTrackSettings,
  HMSAudioTrackSettingsBuilder,
  HMSTrackSettings,
  HMSTrackSettingsBuilder,
  HMSVideoTrackSettings,
  HMSVideoTrackSettingsBuilder,
} from '../media/settings';
import InitialSettings from '../interfaces/settings';
import { HMSLocalAudioTrack, HMSLocalTrack, HMSLocalVideoTrack, HMSTrackType } from '../media/tracks';
import { IStore } from './store';
import { IFetchAVTrackOptions } from '../transport/ITransport';
import HMSLogger from '../utils/logger';
import { HMSException } from '../error/HMSException';
import { ErrorFactory, HMSAction } from '../error/ErrorFactory';
import ITransportObserver from '../transport/ITransportObserver';
import HMSLocalStream from '../media/streams/HMSLocalStream';
import AnalyticsEventFactory from '../analytics/AnalyticsEventFactory';
import { DeviceManager } from '../device-manager';
import { BuildGetMediaError, HMSGetMediaActions } from '../error/utils';
import { ErrorCodes } from '../error/ErrorCodes';
import { EventBus } from '../events/EventBus';

const defaultSettings = {
  isAudioMuted: false,
  isVideoMuted: false,
  audioInputDeviceId: 'default',
  audioOutputDeviceId: 'default',
  videoDeviceId: 'default',
};

let blankCanvas: any;

export class LocalTrackManager {
  readonly TAG: string = '[LocalTrackManager]';

  constructor(
    private store: IStore,
    private observer: ITransportObserver,
    private deviceManager: DeviceManager,
    private eventBus: EventBus,
  ) {}

  async getTracksToPublish(initialSettings: InitialSettings): Promise<HMSLocalTrack[]> {
    const trackSettings = this.getTrackSettings(initialSettings);
    const canPublishAudio = !!trackSettings.audio;
    const canPublishVideo = !!trackSettings.video;
    let tracksToPublish: Array<HMSLocalTrack> = [];
    const { videoTrack, audioTrack } = await this.updateCurrentLocalTrackSettings(trackSettings);
    // The track gets added to the store only after it is published.
    const isVideoTrackPublished = Boolean(videoTrack && this.store.getTrackById(videoTrack.trackId));
    const isAudioTrackPublished = Boolean(audioTrack && this.store.getTrackById(audioTrack.trackId));

    if (isVideoTrackPublished && isAudioTrackPublished) {
      // there is nothing to publish
      return [];
    }

    const fetchTrackOptions: IFetchAVTrackOptions = {
      audio: canPublishAudio && !audioTrack && (initialSettings.isAudioMuted ? 'empty' : true),
      video: canPublishVideo && !videoTrack && (initialSettings.isVideoMuted ? 'empty' : true),
    };
    try {
      HMSLogger.d(this.TAG, 'Init Local Tracks', { fetchTrackOptions });
      tracksToPublish = await this.getLocalTracks(fetchTrackOptions, trackSettings);
    } catch (error) {
      tracksToPublish = await this.retryGetLocalTracks(error, trackSettings, fetchTrackOptions);
    }

    /**
     * concat local tracks only if both are true which means it is either join or switched from a role
     * with no tracks earlier.
     * the reason we need this is for preview API to work, in case of preview we want to publish the same
     * tracks which were shown and are already part of the local peer instead of creating new ones.
     * */
    // if (publishConfig.publishAudio && publishConfig.publishVideo) {
    //   return tracks.concat(localTracks);
    // }
    if (videoTrack && canPublishVideo && !isVideoTrackPublished) {
      tracksToPublish.push(videoTrack);
    }
    if (audioTrack && canPublishAudio && !isAudioTrackPublished) {
      tracksToPublish.push(audioTrack);
    }
    return tracksToPublish;
  }

  async getLocalTracks(
    fetchTrackOptions: IFetchAVTrackOptions = { audio: true, video: true },
    settings: HMSTrackSettings,
  ): Promise<Array<HMSLocalTrack>> {
    try {
      const nativeTracks = await this.getNativeLocalTracks(fetchTrackOptions, settings);
      const nativeVideoTrack = nativeTracks.find(track => track.kind === 'video');
      const nativeAudioTrack = nativeTracks.find(track => track.kind === 'audio');
      const local = new HMSLocalStream(new MediaStream(nativeTracks));

      const tracks: Array<HMSLocalTrack> = [];
      if (nativeAudioTrack && settings?.audio) {
        const audioTrack = new HMSLocalAudioTrack(local, nativeAudioTrack, 'regular', this.eventBus, settings.audio);
        tracks.push(audioTrack);
      }

      if (nativeVideoTrack && settings?.video) {
        const videoTrack = new HMSLocalVideoTrack(local, nativeVideoTrack, 'regular', this.eventBus, settings.video);
        tracks.push(videoTrack);
      }
      return tracks;
    } catch (error) {
      // TOOD: On OverConstrained error, retry with dropping all constraints.
      // Just retry getusermedia again - it sometimes work when AbortError or NotFoundError is thrown on a few devices
      if (error instanceof HMSException) {
        this.eventBus.analytics.publish(
          AnalyticsEventFactory.publish({
            devices: this.deviceManager.getDevices(),
            error,
            settings,
          }),
        );
      }
      throw error;
    }
  }

  private async getNativeLocalTracks(
    fetchTrackOptions: IFetchAVTrackOptions = { audio: false, video: false },
    settings: HMSTrackSettings,
  ) {
    const trackSettings = new HMSTrackSettings(
      fetchTrackOptions.video === true ? settings.video : null,
      fetchTrackOptions.audio === true ? settings.audio : null,
      settings.simulcast,
    );
    const nativeTracks: MediaStreamTrack[] = [];

    if (trackSettings.audio || trackSettings.video) {
      nativeTracks.push(...(await this.getAVTracks(trackSettings)));
    }
    nativeTracks.push(...this.getEmptyTracks(fetchTrackOptions));
    return nativeTracks;
  }

  async getLocalScreen(videosettings: HMSVideoTrackSettings, audioSettings: HMSAudioTrackSettings) {
    const audioConstraints: MediaTrackConstraints = audioSettings.toConstraints();
    // remove advanced constraints as it not supported for screenshare audio
    delete audioConstraints.advanced;
    const constraints = {
      video: videosettings.toConstraints(),
      audio: {
        ...audioConstraints,
        autoGainControl: false,
        noiseSuppression: false,
        googAutoGainControl: false,
        echoCancellation: false,
      },
    } as MediaStreamConstraints;
    let stream;
    try {
      // @ts-ignore [https://github.com/microsoft/TypeScript/issues/33232]
      stream = (await navigator.mediaDevices.getDisplayMedia(constraints)) as MediaStream;
    } catch (err) {
      throw BuildGetMediaError(err as Error, HMSGetMediaActions.SCREEN);
    }

    const tracks: Array<HMSLocalTrack> = [];
    const local = new HMSLocalStream(stream);
    const nativeVideoTrack = stream.getVideoTracks()[0];
    const videoTrack = new HMSLocalVideoTrack(local, nativeVideoTrack, 'screen', this.eventBus, videosettings);
    tracks.push(videoTrack);
    const nativeAudioTrack = stream.getAudioTracks()[0];
    if (nativeAudioTrack) {
      const audioTrack = new HMSLocalAudioTrack(local, nativeAudioTrack, 'screen', this.eventBus, audioSettings);
      tracks.push(audioTrack);
    }

    HMSLogger.v(this.TAG, 'getLocalScreen', tracks);
    return tracks;
  }

  async requestPermissions() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true,
      });
      // Stop stream
      stream.getTracks().forEach(track => track.stop());
    } catch (error) {
      HMSLogger.e(this.TAG, error);
    }
  }

  static getEmptyVideoTrack(prevTrack?: MediaStreamTrack): MediaStreamTrack {
    const width = prevTrack?.getSettings()?.width || 320;
    const height = prevTrack?.getSettings()?.height || 240;
    const frameRate = 10; // fps TODO: experiment, see if this can be reduced
    if (!blankCanvas) {
      blankCanvas = Object.assign(document.createElement('canvas'), { width, height });
      blankCanvas.getContext('2d')?.fillRect(0, 0, width, height);
    }
    const stream = blankCanvas.captureStream(frameRate);
    const emptyTrack = stream.getVideoTracks()[0];
    const intervalID = setInterval(() => {
      if (emptyTrack.readyState === 'ended') {
        clearInterval(intervalID);
        return;
      }
      const ctx = blankCanvas.getContext('2d');
      if (ctx) {
        const pixel = ctx.getImageData(0, 0, 1, 1).data;
        const red = pixel[0] === 0 ? 1 : 0; // toggle red in pixel
        ctx.fillStyle = `rgb(${red}, 0, 0)`;
        ctx.fillRect(0, 0, 1, 1);
      }
    }, 1000 / frameRate);
    emptyTrack.onended = () => {
      clearInterval(intervalID);
    };
    emptyTrack.enabled = false;
    return emptyTrack;
  }

  static getEmptyAudioTrack(): MediaStreamTrack {
    const ctx = new AudioContext();
    const oscillator = ctx.createOscillator();
    const dst = oscillator.connect(ctx.createMediaStreamDestination());
    oscillator.start();
    // @ts-expect-error
    const emptyTrack = dst.stream.getAudioTracks()[0];
    emptyTrack.enabled = false;
    return emptyTrack;
  }

  private async getAVTracks(settings: HMSTrackSettings): Promise<Array<MediaStreamTrack>> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: settings.audio ? settings.audio.toConstraints() : false,
        video: settings.video ? settings.video.toConstraints() : false,
      });

      return stream.getVideoTracks().concat(stream.getAudioTracks());
    } catch (error) {
      await this.deviceManager.init();
      const videoError = !!(!this.deviceManager.hasWebcamPermission && settings.video);
      const audioError = !!(!this.deviceManager.hasMicrophonePermission && settings.audio);
      /**
       * TODO: Only permission error throws correct device info in error(audio or video or both),
       * Right now for other errors such as overconstrained error we are unable to get whether audio/video failure.
       * Fix this by checking the native error message.
       */
      const errorType = this.getErrorType(videoError, audioError);
      throw BuildGetMediaError(error as Error, errorType);
    }
  }

  private getTrackSettings(initialSettings: InitialSettings): HMSTrackSettings {
    const audioSettings = this.getAudioSettings(initialSettings);
    const videoSettings = this.getVideoSettings(initialSettings);
    const screenSettings = this.getScreenSettings();
    return new HMSTrackSettingsBuilder().video(videoSettings).audio(audioSettings).screen(screenSettings).build();
  }

  private async retryGetLocalTracks(
    error: unknown,
    trackSettings: HMSTrackSettings,
    fetchTrackOptions: IFetchAVTrackOptions,
  ): Promise<Array<HMSLocalTrack>> {
    if (error instanceof HMSException && error.action === HMSAction.TRACK) {
      this.observer.onFailure(error);

      const overConstrainedFailure = error.code === ErrorCodes.TracksErrors.OVER_CONSTRAINED;
      const audioFailure = error.message.includes('audio');
      const videoFailure = error.message.includes('video');
      if (overConstrainedFailure) {
        // TODO: Use this once TODO@L#250 is completed
        // const newTrackSettings = new HMSTrackSettingsBuilder()
        //   .video(videoFailure ? new HMSVideoTrackSettings() : trackSettings.video)
        //   .audio(audioFailure ? new HMSAudioTrackSettings() : trackSettings.audio)
        //   .build();
        const newTrackSettings = new HMSTrackSettingsBuilder()
          .video(new HMSVideoTrackSettings())
          .audio(new HMSAudioTrackSettings())
          .build();

        HMSLogger.w(this.TAG, 'Fetch AV Tracks failed with overconstrained error', { fetchTrackOptions }, { error });

        try {
          // Try get local tracks with no constraints
          return await this.getLocalTracks(fetchTrackOptions, newTrackSettings);
        } catch (error) {
          /**
           * This error shouldn't be overconstrained error(as we've dropped all constraints).
           * If it's an overconstrained error, change error code to avoid recursive loop
           * Try get local tracks for empty tracks
           */
          const nativeError: Error | undefined = error instanceof HMSException ? error.nativeError : (error as Error);
          let ex = error;
          if (nativeError?.name === 'OverconstrainedError') {
            const newError = ErrorFactory.TracksErrors.GenericTrack(
              HMSAction.TRACK,
              'Overconstrained error after dropping all constraints',
            );
            newError.addNativeError(nativeError);
            ex = newError;
          }

          return await this.retryGetLocalTracks(ex, trackSettings, fetchTrackOptions);
        }
      }

      fetchTrackOptions.audio = audioFailure ? 'empty' : fetchTrackOptions.audio;
      fetchTrackOptions.video = videoFailure ? 'empty' : fetchTrackOptions.video;
      HMSLogger.w(this.TAG, 'Fetch AV Tracks failed', { fetchTrackOptions }, error);
      try {
        return await this.getLocalTracks(fetchTrackOptions, trackSettings);
      } catch (error) {
        HMSLogger.w(this.TAG, 'Fetch empty tacks failed', error);
        fetchTrackOptions.audio = fetchTrackOptions.audio && 'empty';
        fetchTrackOptions.video = fetchTrackOptions.video && 'empty';
        this.observer.onFailure(ErrorFactory.TracksErrors.GenericTrack(HMSAction.TRACK, (error as Error).message));
        return await this.getLocalTracks(fetchTrackOptions, trackSettings);
      }
    } else {
      HMSLogger.w(this.TAG, 'Fetch AV Tracks failed - unknown exception', error);
      this.observer.onFailure(ErrorFactory.TracksErrors.GenericTrack(HMSAction.TRACK, (error as Error).message));
      return [];
    }
  }

  private getErrorType(videoError: boolean, audioError: boolean): HMSGetMediaActions {
    if (videoError && audioError) {
      return HMSGetMediaActions.AV;
    }
    if (videoError) {
      return HMSGetMediaActions.VIDEO;
    }
    return HMSGetMediaActions.AUDIO;
  }

  private getEmptyTracks(fetchTrackOptions: IFetchAVTrackOptions) {
    const nativeTracks: MediaStreamTrack[] = [];
    if (fetchTrackOptions.audio === 'empty') {
      nativeTracks.push(LocalTrackManager.getEmptyAudioTrack());
    }

    if (fetchTrackOptions.video === 'empty') {
      nativeTracks.push(LocalTrackManager.getEmptyVideoTrack());
    }
    return nativeTracks;
  }

  private async updateCurrentLocalTrackSettings(trackSettings: HMSTrackSettings) {
    const localTracks = this.store.getLocalPeerTracks();
    const videoTrack = localTracks.find(t => t.type === HMSTrackType.VIDEO && t.source === 'regular') as
      | HMSLocalVideoTrack
      | undefined;
    const audioTrack = localTracks.find(t => t.type === HMSTrackType.AUDIO && t.source === 'regular') as
      | HMSLocalAudioTrack
      | undefined;
    const screenTrack = localTracks.find(t => t.type === HMSTrackType.VIDEO && t.source === 'screen') as
      | HMSLocalVideoTrack
      | undefined;

    if (trackSettings.video) {
      await videoTrack?.setSettings(trackSettings.video);
    }

    if (trackSettings.audio) {
      await audioTrack?.setSettings(trackSettings.audio);
    }

    if (trackSettings.screen) {
      await screenTrack?.setSettings(trackSettings.screen);
    }

    return { videoTrack, audioTrack };
  }

  private getAudioSettings(initialSettings: InitialSettings) {
    const publishParams = this.store.getPublishParams();
    if (!publishParams || !publishParams.allowed.includes('audio')) {
      return null;
    }
    const localPeer = this.store.getLocalPeer();
    const audioTrack = localPeer?.audioTrack;
    // Get device from the tracks already added in preview
    const audioDeviceId = audioTrack?.settings.deviceId || initialSettings.audioInputDeviceId;

    return new HMSAudioTrackSettingsBuilder()
      .codec(publishParams.audio.codec as HMSAudioCodec)
      .maxBitrate(publishParams.audio.bitRate)
      .deviceId(audioDeviceId || defaultSettings.audioInputDeviceId)
      .build();
  }

  private getVideoSettings(initialSettings: InitialSettings) {
    const publishParams = this.store.getPublishParams();
    if (!publishParams || !publishParams.allowed.includes('video')) {
      return null;
    }
    const localPeer = this.store.getLocalPeer();
    const videoTrack = localPeer?.videoTrack;
    // Get device from the tracks already added in preview
    const videoDeviceId = videoTrack?.settings.deviceId || initialSettings.videoDeviceId;
    const video = publishParams.video;
    const { width = video.width, height = video.height } = this.store.getSimulcastDimensions('regular') || {};
    return new HMSVideoTrackSettingsBuilder()
      .codec(video.codec as HMSVideoCodec)
      .maxBitrate(video.bitRate)
      .maxFramerate(video.frameRate)
      .setWidth(width) // take simulcast width if available
      .setHeight(height) // take simulcast width if available
      .deviceId(videoDeviceId || defaultSettings.videoDeviceId)
      .build();
  }

  private getScreenSettings() {
    const publishParams = this.store.getPublishParams();
    if (!publishParams || !publishParams.allowed.includes('screen')) {
      return null;
    }
    const screen = publishParams.screen;
    const { width = screen.width, height = screen.height } = this.store.getSimulcastDimensions('screen') || {};
    return (
      new HMSVideoTrackSettingsBuilder()
        // Don't cap maxBitrate for screenshare.
        // If publish params doesn't have bitRate value - don't set maxBitrate.
        .maxBitrate(screen.bitRate, false)
        .codec(screen.codec as HMSVideoCodec)
        .maxFramerate(screen.frameRate)
        .setWidth(width)
        .setHeight(height)
        .build()
    );
  }
}
