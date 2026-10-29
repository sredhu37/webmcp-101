import {
  lazy,
  Suspense,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { api, ApiError, type KeysInfo, type ModelsInfo, type Provider } from '../api.ts';
import { CodeText } from '../components/CodeText.tsx';
import { Icon } from '../components/Icon.tsx';
import {
  defaultModelOf,
  planRun,
  validateFields,
  type NumberField,
  type SetupAction,
  type SetupForm,
} from './form.ts';
import { ScenarioPicker } from './ScenarioPicker.tsx';
import type { SuiteEditorHandle } from './SuiteEditor.tsx';
import { SuiteStatus } from './SuiteStatus.tsx';

const SuiteEditor = lazy(() => import('./SuiteEditor.tsx'));

/** Uploads above this size are refused before they reach the editor. */
const MAX_SUITE_BYTES = 512 * 1024;

export interface SetupProps {
  form: SetupForm;
  dispatch: Dispatch<SetupAction>;
  models: ModelsInfo;
  keys: KeysInfo;
  maxAttempts: number;
  /** A Run is going: every input is locked. */
  locked: boolean;
  /** Called once `POST /api/runs` accepted the Run. */
  onStarted: (id: string) => void;
}

type Phase = 'idle' | 'checking' | 'starting';

interface Notice {
  error: string | null;
  details: string[];
  warnings: string[];
}

const NO_NOTICE: Notice = { error: null, details: [], warnings: [] };

export function Setup({
  form,
  dispatch,
  models,
  keys,
  maxAttempts,
  locked,
  onStarted,
}: SetupProps) {
  const editor = useRef<SuiteEditorHandle>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [notice, setNotice] = useState<Notice>(NO_NOTICE);
  const [upload, setUpload] = useState<{ name: string; error: string | null } | null>(null);

  const plan = planRun(form, keys, maxAttempts);
  const { errors: fieldErrors } = validateFields(form, maxAttempts);
  const busy = phase !== 'idle';
  const disabled = locked || busy;

  async function run() {
    const body = plan.body;
    if (!body || busy) return;
    setNotice(NO_NOTICE);
    setPhase('checking');
    try {
      const preflight = await api.preflight(body);
      if (!preflight.key.ok) {
        setNotice({
          error: preflight.key.message ?? 'The API key check failed.',
          details: [],
          warnings: preflight.warnings,
        });
        return;
      }
      // Warnings (for example a start page without WebMCP tools) never block the Run.
      setNotice({ ...NO_NOTICE, warnings: preflight.warnings });
      setPhase('starting');
      const started = await api.startRun(body);
      dispatch({ type: 'apiKey', value: '' });
      onStarted(started.id);
    } catch (error) {
      setNotice((current) => ({
        ...current,
        error: error instanceof Error ? error.message : String(error),
        details: error instanceof ApiError ? error.errors.filter((e) => e !== error.message) : [],
      }));
    } finally {
      setPhase('idle');
    }
  }

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > MAX_SUITE_BYTES) {
      setUpload({ name: file.name, error: 'is larger than 512 KB; a Suite is a short YAML file.' });
      return;
    }
    try {
      dispatch({ type: 'suiteReplaced', source: await file.text() });
      setUpload({ name: file.name, error: null });
    } catch {
      setUpload({ name: file.name, error: 'could not be read.' });
    }
  }

  return (
    <section className="section" aria-labelledby="setup-title" id="setup">
      <header className="section-head">
        <h2 id="setup-title">Setup</h2>
        {locked && (
          <span className="section-note">
            <Icon name="lock" />
            Locked while the Run is going
          </span>
        )}
      </header>

      <fieldset className="setup-grid" disabled={disabled}>
        <legend className="visually-hidden">Run settings</legend>
        <div className="setup-col">
          <TextField
            label="Site URL"
            value={form.siteUrl}
            error={fieldErrors.siteUrl}
            onChange={(value) => dispatch({ type: 'siteUrl', value })}
            inputProps={{ type: 'url', spellCheck: false, autoComplete: 'url', inputMode: 'url' }}
          />

          <div className="field">
            <div className="field-label-row">
              <span className="field-label" id="suite-label">
                Suite
              </span>
              <span className="field-aside">
                {upload && (
                  <span className={upload.error ? 'upload-note error' : 'upload-note'}>
                    {upload.error ? `${upload.name} ${upload.error}` : `Loaded ${upload.name}`}
                  </span>
                )}
                <button
                  type="button"
                  className="link-button"
                  onClick={() => fileInput.current?.click()}
                >
                  <Icon name="upload" />
                  Upload .yaml
                </button>
                <input
                  ref={fileInput}
                  type="file"
                  accept=".yaml,.yml,application/yaml,text/yaml"
                  className="visually-hidden"
                  tabIndex={-1}
                  aria-hidden="true"
                  onChange={(event) => void onFile(event)}
                />
              </span>
            </div>
            <div
              className="editor-frame"
              data-invalid={!form.suite.ok || undefined}
              data-locked={disabled || undefined}
            >
              <Suspense fallback={<pre className="editor-fallback">{form.suiteSource}</pre>}>
                <SuiteEditor
                  ref={editor}
                  label="Suite YAML"
                  value={form.suiteSource}
                  revision={form.suiteRevision}
                  onChange={(source) => dispatch({ type: 'suiteEdited', source })}
                  errors={form.suite.ok ? [] : form.suite.errors}
                  readOnly={disabled}
                />
              </Suspense>
            </div>
            <SuiteStatus
              suite={form.suite}
              onReveal={(line, column) => editor.current?.reveal(line, column)}
            />
          </div>
        </div>

        <div className="setup-col">
          <ScenarioPicker form={form} dispatch={dispatch} />

          <div className="field-row">
            <SelectField
              label="Provider"
              value={form.provider}
              onChange={(value) => {
                const provider = value as Provider;
                dispatch({ type: 'provider', provider, model: defaultModelOf(models, provider) });
              }}
            >
              {models.providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </SelectField>
            <SelectField
              label="Model"
              value={form.model}
              onChange={(model) => dispatch({ type: 'model', model })}
            >
              {models.models
                .filter((model) => model.provider === form.provider)
                .map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name} ({model.label})
                  </option>
                ))}
            </SelectField>
          </div>

          <ApiKeyField
            form={form}
            keys={keys}
            providerName={
              models.providers.find((provider) => provider.id === form.provider)?.name ??
              form.provider
            }
            onChange={(value) => dispatch({ type: 'apiKey', value })}
          />

          <div className="field-row limits">
            {NUMBER_FIELDS.map(({ field, label, prefix, inputMode }) => (
              <TextField
                key={field}
                label={label}
                value={form.numbers[field]}
                error={fieldErrors[field]}
                prefix={prefix}
                mono
                onChange={(value) => dispatch({ type: 'number', field, value })}
                inputProps={{ inputMode, spellCheck: false, autoComplete: 'off' }}
              />
            ))}
          </div>
          <p className="field-hint">
            Repeat runs each Scenario that many times. Limits apply per Lane per Attempt.
          </p>

          {(notice.error || notice.warnings.length > 0) && (
            <div className="notices" aria-live="polite">
              {notice.error && (
                <div className="notice error" role="alert">
                  <Icon name="x" />
                  <div>
                    <p>
                      <CodeText text={notice.error} />
                    </p>
                    {notice.details.length > 0 && (
                      <ul>
                        {notice.details.map((detail) => (
                          <li key={detail}>
                            <CodeText text={detail} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}
              {notice.warnings.length > 0 && (
                <div className="notice warning">
                  <Icon name="alert" />
                  <div>
                    <p>Pre-Run check warnings; the Run goes ahead:</p>
                    <ul>
                      {notice.warnings.map((warning) => (
                        <li key={warning}>
                          <CodeText text={warning} />
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="actions">
            <button
              type="button"
              className="button primary"
              onClick={() => void run()}
              disabled={disabled || plan.blocker !== null}
              aria-busy={busy || undefined}
              aria-describedby={plan.blocker && !locked ? 'run-blocker' : undefined}
            >
              {busy ? <span className="spinner" aria-hidden="true" /> : <Icon name="play" />}
              {phase === 'checking'
                ? 'Checking key and start pages'
                : phase === 'starting'
                  ? 'Starting the Run'
                  : plan.label}
            </button>
            {plan.blocker && !locked && (
              <span className="actions-note" id="run-blocker">
                {plan.blocker}
              </span>
            )}
          </div>
        </div>
      </fieldset>
    </section>
  );
}

const NUMBER_FIELDS: {
  field: NumberField;
  label: string;
  prefix?: string;
  inputMode: 'numeric' | 'decimal';
}[] = [
  { field: 'attempts', label: 'Repeat', inputMode: 'numeric' },
  { field: 'maxSteps', label: 'Max Steps', inputMode: 'numeric' },
  { field: 'maxMinutes', label: 'Max minutes', inputMode: 'decimal' },
  { field: 'maxCost', label: 'Max cost', prefix: '$', inputMode: 'decimal' },
];

interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  prefix?: string | undefined;
  mono?: boolean;
  inputProps?: InputHTMLAttributes<HTMLInputElement>;
}

function TextField({ label, value, onChange, error, prefix, mono, inputProps }: TextFieldProps) {
  const id = useId();
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className={prefix ? 'input-wrap has-prefix' : 'input-wrap'}>
        {prefix && (
          <span className="input-prefix num" aria-hidden="true">
            {prefix}
          </span>
        )}
        <input
          id={id}
          className={mono ? 'input num' : 'input'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          {...inputProps}
        />
      </div>
      {error && (
        <p className="field-error" id={`${id}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}

interface SelectFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}

function SelectField({ label, value, onChange, children }: SelectFieldProps) {
  const id = useId();
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className="input select"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {children}
      </select>
    </div>
  );
}

interface ApiKeyFieldProps {
  form: SetupForm;
  keys: KeysInfo;
  providerName: string;
  onChange: (value: string) => void;
}

function ApiKeyField({ form, keys, providerName, onChange }: ApiKeyFieldProps) {
  const id = useId();
  const status = keys[form.provider];
  const stored = status.inSession
    ? 'Pasted this session'
    : status.inEnv
      ? 'Loaded from .env'
      : null;
  const pasted = form.apiKey.trim() !== '';
  return (
    <div className="field">
      <div className="field-label-row">
        <label className="field-label" htmlFor={id}>
          API key
        </label>
        <span className={stored || pasted ? 'key-state ok' : 'key-state'}>
          {pasted ? (
            <>
              <Icon name="check" />
              Pasted, used for this Run
            </>
          ) : stored ? (
            <>
              <Icon name="check" />
              {stored}
            </>
          ) : (
            `No ${status.envVar} in .env`
          )}
        </span>
      </div>
      <input
        id={id}
        className="input"
        type="password"
        autoComplete="off"
        spellCheck={false}
        value={form.apiKey}
        placeholder={stored ?? `Paste your ${providerName} API key`}
        onChange={(event) => onChange(event.target.value)}
        aria-describedby={`${id}-hint`}
      />
      <p className="field-hint" id={`${id}-hint`}>
        {stored
          ? 'Paste a key only to use a different one. Keys stay in server memory, never on disk.'
          : 'Keys stay in server memory, never on disk.'}
      </p>
    </div>
  );
}
