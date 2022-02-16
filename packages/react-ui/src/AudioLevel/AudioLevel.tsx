import React, { useCallback, useRef } from 'react';
import { styled, useTheme } from '../Theme';
import { HMSPeer, useAudioLevelStyles } from '@100mslive/react-sdk';

const StyledAudioLevel = styled('div', {
  width: '100%',
  height: '100%',
  position: 'absolute',
  left: 0,
  top: 0,
  borderRadius: '$2',
});

interface Props {
  audioTrack: HMSPeer['audioTrack'];
}

/**
 * displays audio level for peer based on the audioTrack id
 */
export const AudioLevel: React.FC<Props> = ({ audioTrack }) => {
  const { theme } = useTheme();
  const color = theme.colors.brandDefault.value;
  const getStyle = useCallback(
    (level: number) => {
      const style: Record<string, string> = {
        transition: 'box-shadow 0.4s ease-in-out',
      };
      style['box-shadow'] = level
        ? `0px 0px ${24 * sigmoid(level)}px ${color}, 0px 0px ${16 * sigmoid(level)}px ${color}`
        : '';
      return style;
    },
    [color],
  );
  const ref = useRef(null);
  useAudioLevelStyles({
    trackId: audioTrack,
    getStyle,
    ref,
  });
  return <StyledAudioLevel ref={ref} />;
};

export const sigmoid = (z: number) => {
  return 1 / (1 + Math.exp(-z));
};
