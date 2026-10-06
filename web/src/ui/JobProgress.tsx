import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { useGarage } from '../lib/store';
import type { Job } from '../lib/types';

export const fmt = (s: number) => (s < 60 ? `${Math.round(s)} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`);

/** A background job's steps as they run (polled every 2 s), with a retry when it stops. */
export function JobProgress({
  jobId,
  titles,
  done,
}: {
  jobId: string;
  titles: { running: string; done: string; failed: string };
  /** What to offer once it's finished. */
  done?: ReactNode;
}) {
  const load = useGarage((s) => s.load);
  const [job, setJob] = useState<Job | null>(null);
  const [now, setNow] = useState(Date.now() / 1000);
  const [round, setRound] = useState(0);
  useEffect(() => {
    let live = true;
    const tick = async () => {
      try {
        const j = await api.get<Job>(`/jobs/${jobId}`);
        if (!live) return;
        setJob(j);
        if (j.status === 'done' || j.status === 'failed') {
          await load();
          return;
        }
      } catch {
        /* keep polling */
      }
      if (live) setTimeout(tick, 2000);
    };
    void tick();
    const t = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [jobId, load, round]);

  if (!job) return <div className="sheet sheet--loading" />;
  const elapsed = (job.finishedAt ?? now) - (job.startedAt ?? job.createdAt);
  const state = job.status === 'done' ? 'Done' : job.status === 'failed' ? 'Stopped' : job.status === 'queued' ? 'Waiting to start' : 'Working on this Mac';
  return (
    <section className="jobview">
      <header className="jobview__head">
        <div>
          <p className="eyebrow">{state}</p>
          <h2 className="display">{job.status === 'done' ? titles.done : job.status === 'failed' ? titles.failed : titles.running}</h2>
        </div>
        <span className="jobview__time">{fmt(elapsed)}</span>
      </header>
      <ol className="jobsteps">
        {job.steps.map((s) => (
          <li key={s.key} className={`jobstep jobstep--${s.status}`}>
            <span className="jobstep__dot" aria-hidden />
            <div className="jobstep__body">
              <p className="jobstep__label">{s.label}</p>
              {s.detail && <p className="jobstep__detail">{s.detail}</p>}
              {s.status === 'running' && (
                <span className="jobstep__bar">
                  <i style={{ width: `${Math.max(3, s.progress * 100)}%` }} />
                </span>
              )}
            </div>
            <span className="jobstep__time">
              {s.status === 'done' && s.seconds != null ? fmt(s.seconds) : s.status === 'running' && s.startedAt ? fmt(now - s.startedAt) : ''}
            </span>
          </li>
        ))}
      </ol>
      {job.status === 'failed' && (
        <>
          <p className="note note--bad">{job.error}</p>
          <div className="actions">
            <button
              className="btn"
              onClick={async () => {
                await api.post(`/jobs/${job.id}/retry`, {});
                await load();
                setRound((r) => r + 1);
              }}
            >
              Retry from where it stopped
            </button>
          </div>
        </>
      )}
      {job.status === 'done' && done && <div className="actions">{done}</div>}
      {job.status !== 'done' && job.status !== 'failed' && (
        <p className="muted">You can leave this page; it keeps going in the background.</p>
      )}
    </section>
  );
}
