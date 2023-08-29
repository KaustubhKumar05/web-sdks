import React from 'react';
import { useMedia } from 'react-use';
import { HMSRoomState, selectRoomState, useHMSStore } from '@100mslive/react-sdk';
import { config as cssConfig, Flex } from '../../../';
import { Logo, SpeakerTag } from './HeaderComponents';
import { LiveStatus, RecordingStatus, StreamActions } from './StreamActions';
import { AudioOutputActions, CamaraFlipActions } from './common';

export const ConferencingHeader = () => {
  const roomState = useHMSStore(selectRoomState);
  const isMobile = useMedia(cssConfig.media.md);
  // Header should be present only inside the call - not in preview, leave room states
  if (roomState !== HMSRoomState.Connected) {
    return <></>;
  }
  return (
    <Flex justify="between" align="center" css={{ position: 'relative', height: '100%' }}>
      <Flex align="center" gap="2" css={{ position: 'absolute', left: '$10' }}>
        <Logo />
        <SpeakerTag />
        {isMobile && (
          <Flex align="center" css={{ gap: '$4' }}>
            <LiveStatus />
            <RecordingStatus />
          </Flex>
        )}
      </Flex>
      <Flex
        align="center"
        css={{
          position: 'absolute',
          right: '$10',
          gap: '$4',
        }}
      >
        <StreamActions />
        {isMobile ? (
          <>
            <CamaraFlipActions />
            <AudioOutputActions />
          </>
        ) : null}
      </Flex>
    </Flex>
  );
};
