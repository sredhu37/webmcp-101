import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import {
  api,
  type Defaults,
  type KeysInfo,
  type ModelsInfo,
  type Results,
  type RunListItem,
} from './api.ts';
import { Icon } from './components/Icon.tsx';
import { LiveConnection, emptyLiveState, type LiveState } from './live/client.ts';
import { FrameBus } from './live/frames.ts';
import { runningRunId } from './live/view.ts';
import { LiveSection } from './sections/LiveSection.tsx';
import { ResultsSection } from './sections/ResultsSection.tsx';
import { formFromResults, initialForm, setupReducer } from './setup/form.ts';
import { Setup } from './setup/Setup.tsx';
import { PastRuns } from './sidebar/PastRuns.tsx';

interface Boot {
  defaults: Defaults;
  models: ModelsInfo;
  keys: KeysInfo;
}

const SIDEBAR_KEY = 'webmcp-comparer:sidebar';

export function App() {
  const [boot, setBoot] = useState<Boot | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.defaults(), api.models(), api.keys()]).then(
      ([defaults, models, keys]) => {
        if (!cancelled) setBoot({ defaults, models, keys });
      },
      (error: unknown) => {
        if (!cancelled) setBootError(errorText(error));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  if (boot) return <Workspace {...boot} />;
  return (
    <main className="boot">
      <h1>webMCP-comparer</h1>
      {bootError ? (
        <div className="notice error" role="alert">
          <Icon name="x" />
          <div>
            <p>The app server did not answer: {bootError}</p>
            <button
              type="button"
              className="button"
              onClick={() => {
                setBootError(null);
                setAttempt((n) => n + 1);
              }}
            >
              <Icon name="retry" />
              Try again
            </button>
          </div>
        </div>
      ) : (
        <p className="muted">Loading</p>
      )}
    </main>
  );
}

function Workspace({ defaults, models, keys: initialKeys }: Boot) {
  const [form, dispatch] = useReducer(setupReducer, defaults, initialForm);
  const [keys, setKeys] = useState(initialKeys);
  const [runs, setRuns] = useState<RunListItem[] | null>(null);
  const [runsError, setRunsError] = useState<string | null>(null);
  // A Run this page started, until the live state knows it.
  const [startedId, setStartedId] = useState<string | null>(null);
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [results, setResults] = useState<Results | null>(null);
  // A past Run opened from the sidebar, shown in Live with its last screenshots.
  const [past, setPast] = useState<Results | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(
    () => window.localStorage.getItem(SIDEBAR_KEY) !== 'closed',
  );
  const [live, setLive] = useState<LiveState>(emptyLiveState);
  const [frames] = useState(() => new FrameBus());
  const runningId = runningRunId(live, startedId);

  // One live connection for the page: Run and Lane state, and each Lane's frames.
  useEffect(() => {
    let runId: string | null = null;
    const connection = new LiveConnection({
      onState: (state) => {
        const id = state.run?.id ?? null;
        if (id !== runId) {
          runId = id;
          frames.clear();
        }
        setLive(state);
      },
      onFrame: (lane, jpeg) => frames.push(lane, jpeg),
    });
    return () => connection.close();
  }, [frames]);

  const syncRuns = useCallback(
    () =>
      api.runs().then(
        (list) => {
          setRuns(list.runs);
          setRunsError(null);
          // The server is not running the Run this page started (it ended, or the server restarted).
          if (list.running === null) setStartedId(null);
        },
        (error: unknown) => setRunsError(errorText(error)),
      ),
    [],
  );

  useEffect(() => {
    void syncRuns();
  }, [syncRuns]);

  // Every Run-level live event (start, next Scenario, end) refreshes Past Runs: no polling.
  const liveRun = live.run;
  useEffect(() => {
    if (liveRun) void syncRuns();
  }, [liveRun, syncRuns]);

  // When the Run ends, show its results and pick up a key the server now keeps for the session.
  const previousRun = useRef<string | null>(null);
  useEffect(() => {
    const ended = previousRun.current;
    previousRun.current = runningId;
    if (!ended || ended === runningId) return;
    setStartedId(null);
    api.run(ended).then(setResults, (error: unknown) => setNotice(errorText(error)));
    api.keys().then(setKeys, () => undefined);
  }, [runningId]);

  function onStarted(id: string) {
    setResults(null);
    setPast(null);
    setNotice(null);
    setStartedId(id);
    void syncRuns();
    api.keys().then(setKeys, () => undefined);
  }

  function stop() {
    if (!runningId) return;
    setStoppingId(runningId);
    api.stopRun(runningId).catch((error: unknown) => {
      setStoppingId(null);
      setNotice(errorText(error));
    });
  }

  function open(id: string) {
    setNotice(null);
    api.run(id).then(
      (opened) => {
        dispatch({ type: 'load', form: formFromResults(opened, models) });
        setResults(opened);
        setPast(opened);
      },
      (error: unknown) => setNotice(`Could not open Run ${id}: ${errorText(error)}`),
    );
  }

  function toggleSidebar() {
    const next = !sidebarOpen;
    window.localStorage.setItem(SIDEBAR_KEY, next ? 'open' : 'closed');
    setSidebarOpen(next);
  }

  return (
    <div className="shell">
      <PastRuns
        runs={runs}
        error={runsError}
        models={models}
        open={sidebarOpen}
        onToggle={toggleSidebar}
        onOpen={open}
        onRetry={() => void syncRuns()}
        openedId={results?.run.id ?? null}
        busy={runningId !== null}
      />
      <main className="main">
        <header className="top">
          <h1>webMCP-comparer</h1>
          <p>Same task, same site: Browser tools only, against Browser tools plus WebMCP tools.</p>
        </header>
        {notice && (
          <div className="notice error page-notice" role="alert">
            <Icon name="x" />
            <p>{notice}</p>
          </div>
        )}
        <Setup
          form={form}
          dispatch={dispatch}
          models={models}
          keys={keys}
          maxAttempts={defaults.maxAttempts}
          locked={runningId !== null}
          onStarted={onStarted}
        />
        <LiveSection
          live={live}
          frames={frames}
          runningId={runningId}
          past={past}
          stopping={stoppingId !== null && stoppingId === runningId}
          onStop={stop}
        />
        <ResultsSection results={results} models={models} />
      </main>
    </div>
  );
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
