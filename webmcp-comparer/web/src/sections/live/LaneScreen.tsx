import { useEffect, useRef, useState } from 'react';
import type { LaneId } from '../../api.ts';
import { decodeJpeg } from '../../live/client.ts';
import type { FrameBus } from '../../live/frames.ts';
import { LANE_NAMES } from '../../results/view.ts';

/** Size of a screencast frame (the 1280x800 Lane viewport scaled down). */
const FRAME_WIDTH = 800;
const FRAME_HEIGHT = 500;

export type ScreenSource =
  | { kind: 'live'; frames: FrameBus }
  /** A past Run: the Lane's last agent screenshot, or null when it took none. */
  | { kind: 'screenshot'; url: string | null };

export interface LaneScreenProps {
  lane: LaneId;
  source: ScreenSource;
  /** The Lane has ended: the screen is dimmed a little. */
  ended: boolean;
}

/** The Lane's browser: live frames on a canvas, or a past Run's last screenshot. */
export function LaneScreen({ lane, source, ended }: LaneScreenProps) {
  return (
    <div className="screen" data-ended={ended ? '' : undefined}>
      {source.kind === 'live' ? (
        <LiveCanvas lane={lane} frames={source.frames} />
      ) : (
        <Screenshot key={source.url ?? 'none'} lane={lane} url={source.url} />
      )}
    </div>
  );
}

function LiveCanvas({ lane, frames }: { lane: LaneId; frames: FrameBus }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [drawn, setDrawn] = useState(false);

  useEffect(() => {
    let decoding = false;
    let waiting: Uint8Array | null = null;
    let active = true;

    // Decodes one frame at a time; frames arriving meanwhile are dropped except the newest.
    const draw = (jpeg: Uint8Array): void => {
      if (decoding) {
        waiting = jpeg;
        return;
      }
      decoding = true;
      decodeJpeg(jpeg).then(
        (bitmap) => {
          const context = canvas.current?.getContext('2d');
          if (active && context) {
            context.drawImage(bitmap, 0, 0, FRAME_WIDTH, FRAME_HEIGHT);
            setDrawn(true);
          }
          bitmap.close();
          next();
        },
        () => next(),
      );
    };
    const next = (): void => {
      decoding = false;
      const frame = waiting;
      waiting = null;
      if (frame && active) draw(frame);
    };

    const unsubscribe = frames.subscribe(lane, draw);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [frames, lane]);

  return (
    <>
      <canvas
        ref={canvas}
        width={FRAME_WIDTH}
        height={FRAME_HEIGHT}
        role="img"
        aria-label={`${LANE_NAMES[lane]} Lane browser, live`}
        data-frame={drawn ? 'drawn' : undefined}
      />
      {!drawn && <p className="screen-empty">Waiting for the first frame</p>}
    </>
  );
}

function Screenshot({ lane, url }: { lane: LaneId; url: string | null }) {
  const [state, setState] = useState<'loading' | 'loaded' | 'missing'>('loading');

  if (!url) {
    return <p className="screen-empty">No screenshots in this Run</p>;
  }
  return (
    <>
      <img
        src={url}
        alt={`${LANE_NAMES[lane]} Lane, last screenshot of the Run`}
        data-state={state}
        onLoad={() => setState('loaded')}
        onError={() => setState('missing')}
      />
      {state === 'missing' && (
        <p className="screen-empty">The last screenshot could not be loaded</p>
      )}
    </>
  );
}
