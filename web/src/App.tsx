import { lazy, Suspense, useEffect } from 'react';
import { useRoute, type Route } from './lib/route';
import { carName, useGarage } from './lib/store';
import { About } from './pages/About';
import { Home } from './pages/Home';
import { Snap } from './pages/Snap';
import { Spotter } from './pages/Spotter';
import { Footer } from './ui/Footer';
import { Header } from './ui/Header';

// Pages with Gaussian splats load the splat renderer (Spark, the largest library) only when opened.
const CarPage = lazy(() => import('./pages/Car').then((m) => ({ default: m.CarPage })));
const Garage = lazy(() => import('./pages/Garage').then((m) => ({ default: m.Garage })));

const TITLES: Record<Exclude<Route['page'], 'car'>, string> = {
  home: 'Chassis: know any car, turn yours into 3D',
  snap: 'Snap & Spec · Chassis',
  spotter: 'Spotter · Chassis',
  garage: 'My garage · Chassis',
  about: 'How it works · Chassis',
};

export function App() {
  const route = useRoute();
  const load = useGarage((s) => s.load);
  const cars = useGarage((s) => s.cars);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (route.page !== 'car') document.title = TITLES[route.page];
    else {
      const car = cars.find((c) => c.id === route.id);
      document.title = `${car ? car.nickname || carName(car.identity) : 'Car'} · Chassis`;
    }
  }, [route, cars]);

  return (
    <div className="site">
      <Header route={route} />
      <main className="main" data-page={route.page}>
        {route.page === 'home' && <Home />}
        {route.page === 'snap' && <Snap />}
        {route.page === 'spotter' && <Spotter />}
        <Suspense fallback={<div className="page wrap" aria-busy="true" />}>
          {route.page === 'garage' && <Garage />}
          {route.page === 'car' && <CarPage id={route.id} tab={route.tab} />}
        </Suspense>
        {route.page === 'about' && <About />}
      </main>
      <Footer />
    </div>
  );
}
