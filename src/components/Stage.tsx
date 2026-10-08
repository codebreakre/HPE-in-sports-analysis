// The canvas the annotated frames are drawn on, plus the hidden <video> that frames are read from.
import { useEffect, useRef } from "react";
import { Center, Paper, Text } from "@mantine/core";
import { useAppState, useController } from "../app/AppContext";

export function Stage() {
  const controller = useController();
  const { source, result } = useAppState();
  const empty = !source && !result; // nothing drawn yet
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    controller.attachStage(videoRef.current!, canvasRef.current!);
  }, [controller]);

  return (
    <Paper withBorder bg="black" mih={360} style={{ overflow: "hidden" }}>
      <Center mih={360}>
        <canvas ref={canvasRef} className="stage-canvas" hidden={empty} />
        {empty && (
          <Text c="gray.5" ta="center" p="xl">
            Choose a video from the data/ folder, open a file, or start the webcam.
          </Text>
        )}
      </Center>
      <video ref={videoRef} muted playsInline hidden />
    </Paper>
  );
}
