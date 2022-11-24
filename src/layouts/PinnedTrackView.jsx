import React from "react";
import { useMeasure } from "react-use";
import { selectPeers, useHMSStore } from "@100mslive/react-sdk";
import { Flex, useTheme } from "@100mslive/react-ui";
import { GridSidePaneView } from "../components/gridView";
import VideoTile from "../components/VideoTile";
import { usePinnedTrack } from "../components/AppData/useUISettings";

const PinnedPeerView = () => {
  const { aspectRatio } = useTheme();
  const pinnedTrack = usePinnedTrack();
  const [ref, { height, width }] = useMeasure();
  const peers = (useHMSStore(selectPeers) || []).filter(
    peer =>
      peer.videoTrack || peer.audioTrack || peer.auxiliaryTracks.length > 0
  );
  if (peers.length === 0) {
    return null;
  }
  const showSidePane = pinnedTrack && peers.length > 1;

  let finalWidth = (aspectRatio.width / aspectRatio.height) * height;
  let finalHeight = height;

  if (finalWidth > width) {
    finalWidth = width;
    finalHeight = (aspectRatio.height / aspectRatio.width) * width;
  }

  return (
    <Flex css={{ size: "100%", "@lg": { flexDirection: "column" } }}>
      <Flex
        css={{
          flex: "1 1 0",
          height: "100%",
          p: "$8",
          minHeight: 0,
          justifyContent: "center",
          alignItems: "center",
        }}
        ref={ref}
      >
        <VideoTile
          key={pinnedTrack.id}
          trackId={pinnedTrack.id}
          peerId={pinnedTrack.peerId}
          height={finalHeight}
          width={finalWidth}
          visible={true}
        />
      </Flex>
      {showSidePane && (
        <GridSidePaneView
          peers={peers.filter(peer => peer.id !== pinnedTrack.peerId)}
        />
      )}
    </Flex>
  );
};

export default PinnedPeerView;
