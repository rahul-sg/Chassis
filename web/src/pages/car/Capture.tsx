import { useRef, useState } from 'react';
import { api } from '../../lib/api';
import { go } from '../../lib/route';
import { useGarage } from '../../lib/store';
import type { Car, Job } from '../../lib/types';
import { UploadIcon } from '../../ui/icons';
import { JobProgress } from '../../ui/JobProgress';
import { GUIDE } from './Car360';

/** Upload with progress (fetch can't report upload progress). */
function uploadVideo(carId: string, file: File, onProgress: (f: number) => void): Promise<Job> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/cars/${carId}/capture`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      if (xhr.status < 300) resolve(JSON.parse(xhr.responseText));
      else {
        let msg = 'Upload failed.';
        try {
          msg = JSON.parse(xhr.responseText).detail ?? msg;
        } catch {
          /* not JSON */
        }
        reject(new Error(msg));
      }
    };
    xhr.onerror = () => reject(new Error('The local engine isn’t running. Start it with npm run dev.'));
    const form = new FormData();
    form.append('file', file, file.name);
    xhr.send(form);
  });
}

/** What the browser can tell about a video before uploading it: its shape and length. */
function precheck(file: File): Promise<string[]> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    const done = (issues: string[]) => {
      URL.revokeObjectURL(url);
      resolve(issues);
    };
    v.onloadedmetadata = () => {
      const issues: string[] = [];
      if (v.videoHeight > v.videoWidth)
        issues.push('It’s filmed upright (portrait). Sideways (landscape) keeps the whole car in each frame and makes a much better model.');
      if (v.duration && v.duration < 15) issues.push(`It’s only ${Math.round(v.duration)} seconds long. Walk round slowly: 30–60 seconds.`);
      if (v.duration > 180) issues.push(`It’s ${Math.round(v.duration / 60)} minutes long. One or two slow loops (30–60 seconds) is all it needs.`);
      done(issues);
    };
    v.onerror = () => done([]); // can't read it here (an unusual codec): the server checks it anyway
    v.src = url;
  });
}

export function CarCapture({ car }: { car: Car }) {
  const load = useGarage((s) => s.load);
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [pending, setPending] = useState<{ file: File; issues: string[] } | null>(null);
  const cap = car.capture;
  const building = cap?.status === 'queued' || cap?.status === 'running' || cap?.status === 'paused';
  // A finished model is replaced by filming again: its old build log isn't worth showing.
  const showJob = !!cap?.job && (building || cap.status === 'failed');

  const pick = async (f: File) => {
    setError(null);
    const issues = await precheck(f);
    if (issues.length) setPending({ file: f, issues });
    else void start(f);
  };

  const start = async (f: File) => {
    setPending(null);
    setError(null);
    setUploading(0);
    try {
      await uploadVideo(car.id, f, setUploading);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(null);
    }
  };

  const upload = (
    <section
      className={`drop drop--video ${over ? 'drop--over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files[0];
        if (f) void pick(f);
      }}
    >
      <span className="drop__icon">
        <UploadIcon />
      </span>
      <p className="drop__title">{cap?.status === 'done' ? 'Replace with a new walk-around' : 'Drop your walk-around video'}</p>
      <p className="drop__hint">MP4, MOV or WebM, 30–60 seconds. It stays on this Mac.</p>
      {pending ? (
        <div className="jobask precheck">
          <ul>
            {pending.issues.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
          <div className="actions">
            <button className="btn btn--accent" onClick={() => setPending(null)}>
              Choose another video
            </button>
            <button className="btn" onClick={() => void start(pending.file)}>
              Use this one anyway
            </button>
          </div>
        </div>
      ) : uploading != null ? (
        <div className="upload">
          <span className="jobstep__bar">
            <i style={{ width: `${uploading * 100}%` }} />
          </span>
          <span>Copying the video… {Math.round(uploading * 100)}%</span>
        </div>
      ) : (
        <button className="btn btn--accent" onClick={() => input.current?.click()}>
          Choose a video
        </button>
      )}
      <input
        ref={input}
        type="file"
        accept="video/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void pick(f);
        }}
      />
    </section>
  );

  return (
    <div className="capture">
      {error && <p className="note note--bad">{error}</p>}
      {showJob && cap?.job && (
        <JobProgress
          jobId={cap.job}
          titles={{
            running: car.previousCapture ? 'Building the new 3D model' : 'Building the 3D model',
            done: 'Your car is in 3D',
            failed: 'That video didn’t work',
            paused: 'Check this video first',
          }}
          done={
            <button className="btn btn--accent btn--lg" onClick={() => go({ page: 'car', id: car.id, tab: '360' })}>
              Open the 360
            </button>
          }
        />
      )}
      {cap?.status === 'done' && cap.retakeError && cap.retakeJob && (
        <JobProgress
          jobId={cap.retakeJob}
          titles={{ running: 'Building the new 3D model', done: 'Your car is in 3D', failed: 'The new video didn’t work' }}
        />
      )}
      {cap?.status === 'done' && (
        <header className="capture__again">
          <h2 className="subhead">Film it again</h2>
          <p className="muted">
            Your current 3D model stays on the 360 tab until the new one is built (15–30 minutes). If the new video doesn’t work, nothing is lost.
          </p>
          {cap.video && (
            <div className="capture__rebuild">
              <span className="muted">Or rebuild from the video you already filmed, with the latest processing (truer colour from phone HDR video, cleaner edges).</span>
              <button
                className="btn btn--sm"
                onClick={async () => {
                  setError(null);
                  try {
                    await api.post(`/cars/${car.id}/capture/rebuild`, {});
                    await load();
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Rebuild from the same video
              </button>
            </div>
          )}
        </header>
      )}
      {(!cap || cap.status === 'failed' || cap.status === 'done') && (
        <div className="capture__new">
          {upload}
          <ol className="guide">
            {GUIDE.map((g, i) => (
              <li key={g.title}>
                <span className="steps__n">0{i + 1}</span>
                <h3>{g.title}</h3>
                <p>{g.text}</p>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
