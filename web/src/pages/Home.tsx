import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { go, href, type Route } from '../lib/route';
import { carName, useGarage } from '../lib/store';
import { useOnScreen } from '../lib/useOnScreen';
import { ScanCar } from '../three/ScanCar';
import { CarThumb } from '../ui/CarThumb';
import { ArrowIcon } from '../ui/icons';

interface Feature {
  name: string;
  text: string;
  to: Route;
  where: string;
}

const FEATURES: Feature[] = [
  {
    name: 'Snap & Spec',
    text: 'Make, model and likely years from one photo, then the full sheet: engine, gearbox, economy, running cost, recalls and crash ratings. Add the VIN and it’s exact.',
    to: { page: 'snap' },
    where: 'Open',
  },
  {
    name: 'Spotter',
    text: 'Point your phone at cars on the street. Every one you spot is logged with what it is.',
    to: { page: 'spotter' },
    where: 'Open',
  },
  {
    name: 'Walk-around 360',
    text: 'A 30-second video becomes a photoreal 3D model at real size, with its specs pinned on. No video? A quick AI sketch from one photo.',
    to: { page: 'garage' },
    where: 'Any car in your garage',
  },
  {
    name: 'Mods',
    text: 'Paint colour and finish, wheel colour and window tint, tried on a photo of your own car.',
    to: { page: 'garage' },
    where: 'Any car in your garage',
  },
  {
    name: 'Condition',
    text: 'Mark scratches and dents on the 3D model, compare before-and-after photos, and print a dated record.',
    to: { page: 'garage' },
    where: 'Any car in your garage',
  },
  {
    name: 'Sell kit',
    text: 'Studio photos, a listing written from the real numbers, and a small site with the 3D model for buyers.',
    to: { page: 'garage' },
    where: 'Any car in your garage',
  },
  {
    name: 'Virtual garage',
    text: 'Everything you own or want, parked side by side at real size. Compare any two.',
    to: { page: 'garage' },
    where: 'Open',
  },
];

/** A real result (EPA and NHTSA data for this car), shown the way a build sheet would. */
const EXAMPLE = [
  ['Engine', '2.5 L 4-cyl'],
  ['Gearbox', '8-speed automatic'],
  ['Drive', 'Front-wheel'],
  ['Economy', '29 / 41 / 34 mpg'],
  ['Fuel cost', '$1,950 a year'],
  ['NHTSA overall', '5 of 5 stars'],
];

function Hero() {
  const ref = useRef<HTMLElement>(null);
  const on = useOnScreen(ref, '0px', true);
  const cars = useGarage((s) => s.cars);
  return (
    <section className="hero" ref={ref} aria-labelledby="hero-title">
      <div className="hero__stage" aria-hidden="true">
        <ScanCar active={on} />
      </div>
      <div className="hero__inner wrap">
        <div className="hero__copy">
          <h1 className="display hero__title" id="hero-title">
            Know any car from one photo.
          </h1>
          <p className="hero__lede">
            Point a camera at a car and get its make, model, years and full spec sheet, straight from EPA and NHTSA data. Film a walk-around
            of your own and it becomes a 3D model you can spin, restyle, check over and list for sale.
          </p>
          <div className="actions">
            <button className="btn btn--accent btn--lg" onClick={() => go({ page: 'snap' })}>
              Identify a car
            </button>
            <button
              className="btn btn--lg"
              onClick={() => go(cars[0] ? { page: 'car', id: cars[0].id, tab: 'capture' } : { page: 'garage' })}
            >
              Scan your car in 3D
            </button>
          </div>
          <p className="hero__note mono">Runs on your Mac · U.S. models, 1984 on</p>
        </div>
        <aside className="plate" aria-label="Example result">
          <header className="plate__head">
            <span>Example result</span>
            <span>EPA · NHTSA</span>
          </header>
          <p className="plate__car">2019 Toyota Camry</p>
          <dl>
            {EXAMPLE.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </aside>
      </div>
    </section>
  );
}

function Features() {
  return (
    <section className="section wrap" aria-labelledby="features-title">
      <header className="section__head">
        <h2 className="display" id="features-title">
          What it does
        </h2>
      </header>
      <ol className="index">
        {FEATURES.map((f, i) => (
          <li key={f.name}>
            <a href={href(f.to)}>
              <span className="index__n mono">{String(i + 1).padStart(2, '0')}</span>
              <span className="index__name">{f.name}</span>
              <span className="index__text">{f.text}</span>
              <span className="index__go">
                {f.where} <ArrowIcon />
              </span>
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}

function YourGarage() {
  const cars = useGarage((s) => s.cars);
  const spotted = useGarage((s) => s.spotted);
  return (
    <section className="section wrap" aria-labelledby="garage-title">
      <header className="section__head section__head--row">
        <h2 className="display" id="garage-title">
          Your garage <span className="count-figure mono">{cars.length}</span>
        </h2>
        <div className="actions">
          {spotted.length > 0 && (
            <a className="btn" href={href({ page: 'spotter' })}>
              {spotted.length} spotted
            </a>
          )}
          <a className="btn" href={href({ page: 'garage' })}>
            Open the garage <ArrowIcon />
          </a>
        </div>
      </header>
      {cars.length ? (
        <div className="cars">
          {cars.slice(0, 4).map((c) => (
            <a key={c.id} className="carcard" href={href({ page: 'car', id: c.id, tab: '360' })}>
              <CarThumb car={c} />
              <span className="carcard__name">{c.nickname || carName(c.identity)}</span>
              <span className="carcard__meta">{c.nickname ? carName(c.identity) : c.color?.name ?? ''}</span>
            </a>
          ))}
        </div>
      ) : (
        <div className="empty">
          <p>Nothing parked yet. Snap a photo of your car to add it: the specs come straight away, and the 3D whenever you film it.</p>
          <button className="btn btn--accent" onClick={() => go({ page: 'snap' })}>
            Add your car
          </button>
        </div>
      )}
    </section>
  );
}

function HowItWorks() {
  const steps = [
    {
      title: 'From a photo',
      text: 'The car is found in the picture and compared with every make and model sold in the U.S. since 1984. The specs come from government data, never guessed.',
    },
    {
      title: 'From a video',
      text: 'Frames from your walk-around are placed in 3D and fused into a Gaussian splat: millions of tiny coloured blobs that look like the real car from any angle.',
    },
    {
      title: 'Then',
      text: 'Specs pinned on the model, paint and wheel previews, damage records, studio photos for a listing, and a bay in your virtual garage.',
    },
  ];
  return (
    <section className="section wrap" aria-labelledby="how-title">
      <header className="section__head section__head--row">
        <h2 className="display" id="how-title">
          How it works
        </h2>
        <a className="btn" href={href({ page: 'about' })}>
          The details <ArrowIcon />
        </a>
      </header>
      <ol className="steps">
        {steps.map((s, i) => (
          <li key={s.title}>
            <span className="steps__n">{String(i + 1).padStart(2, '0')}</span>
            <h3>{s.title}</h3>
            <p>{s.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Numbers() {
  const [vehicles, setVehicles] = useState<number | null>(null);
  useEffect(() => {
    api
      .get<{ vehicles: number }>('/stats')
      .then((s) => setVehicles(s.vehicles))
      .catch(() => undefined);
  }, []);
  return (
    <section className="section wrap" aria-labelledby="numbers-title">
      <header className="section__head">
        <h2 className="display" id="numbers-title">
          The numbers behind it
        </h2>
      </header>
      <dl className="numbers">
        <div>
          <dt className="mono">{vehicles ? vehicles.toLocaleString() : '50,000+'}</dt>
          <dd>
            Vehicles in the EPA’s fuel economy records, 1984 to today, with NHTSA recalls and crash ratings on top. Every value shows where it
            came from.
          </dd>
        </div>
        <div>
          <dt className="mono">81%</dt>
          <dd>
            Photos matched to the exact make and model, and 97% in the top five, measured on 600 photos it had never seen. When it isn’t sure,
            it says so.
          </dd>
        </div>
        <div>
          <dt className="mono">15–30 min</dt>
          <dd>From a walk-around video to a 3D model on an M1 Pro, all on the Mac itself: your photos and videos never leave it.</dd>
        </div>
      </dl>
    </section>
  );
}

export function Home() {
  return (
    <div className="home">
      <Hero />
      <Features />
      <YourGarage />
      <HowItWorks />
      <Numbers />
    </div>
  );
}
