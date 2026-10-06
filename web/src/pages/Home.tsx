import { useRef } from 'react';
import { go, href } from '../lib/route';
import { carName, useGarage } from '../lib/store';
import { useOnScreen } from '../lib/useOnScreen';
import { ScanCar } from '../three/ScanCar';
import { CarThumb } from '../ui/CarThumb';
import { ArrowIcon } from '../ui/icons';

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
            Every car on the street, down to the gearbox.
          </h1>
          <p className="hero__lede">
            Photograph a car and get its engine, gearbox, fuel economy and crash rating from EPA and NHTSA records. Film your own and Chassis
            turns it into a 3D model you can restyle, inspect and list.
          </p>
          <div className="actions">
            <button className="btn btn--accent btn--lg" onClick={() => go({ page: 'identify' })}>
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

/**
 * The two things Chassis does, in plain words for car people (the measurements in full are on How
 * it works). Everything else gets one sentence.
 */
function Pitch() {
  const cars = useGarage((s) => s.cars);
  return (
    <section className="section wrap" aria-labelledby="pitch-title">
      <header className="section__head">
        <h2 className="display" id="pitch-title">
          What it does
        </h2>
      </header>
      <div className="pitch">
        <article>
          <p className="pitch__label mono">Identify</p>
          <h3 className="pitch__name">Point at any car. Know what it&nbsp;is.</h3>
          <p>
            Snap any car from 1984 on and get the make, model, years and the full spec sheet. When it says it’s sure, it’s almost always
            right. When it isn’t sure, it tells you and shows the other likely cars. Got the VIN? Then it’s exact.
          </p>
          <a className="pitch__go" href={href({ page: 'identify' })}>
            Identify a car <ArrowIcon />
          </a>
        </article>
        <article>
          <p className="pitch__label mono">3D scan</p>
          <h3 className="pitch__name">Film your car. Get it in 3D.</h3>
          <p>
            Walk around your car filming for under a minute, phone at chest height. You get a 3D model you can spin to any angle, at its real
            size: a Lexus UX came out within 4&nbsp;cm of its real length.
          </p>
          <a
            className="pitch__go"
            href={href(cars[0] ? { page: 'car', id: cars[0].id, tab: 'capture' } : { page: 'garage' })}
          >
            Scan your car <ArrowIcon />
          </a>
        </article>
      </div>
      <p className="pitch__rest">
        Plus: full specs and recalls, a log of every car you spot, paint and wheel previews, a record of dents and scratches, a kit for
        selling, and a garage that parks your cars side by side.
      </p>
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
            <a className="btn" href={href({ page: 'spotted' })}>
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
          <p>Nothing parked yet. Photograph your car to add it: the specs come straight away, and the 3D whenever you film it.</p>
          <button className="btn btn--accent" onClick={() => go({ page: 'identify' })}>
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
      text: 'The car is found in the picture and compared with every model in the EPA’s U.S. records since 1984. The specs come from government data, never guessed.',
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

export function Home() {
  return (
    <div className="home">
      <Hero />
      <Pitch />
      <YourGarage />
      <HowItWorks />
    </div>
  );
}
