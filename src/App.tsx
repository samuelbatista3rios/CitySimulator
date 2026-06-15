import { useEffect } from 'react';
import { CityScene } from './rendering/CityScene';
import { Dashboard } from './ui/Dashboard';
import { CitizenPanel } from './ui/CitizenPanel';
import { TimeControls } from './ui/TimeControls';
import { EventFeed } from './ui/EventFeed';
import { SearchBox } from './ui/SearchBox';
import { LawsPanel } from './ui/LawsPanel';
import { VenueLegend } from './ui/VenueLegend';
import { MobileTabBar } from './ui/MobileTabBar';
import { MobileTopBar } from './ui/MobileTopBar';
import { useIsMobile } from './ui/useIsMobile';
import { useGenesis } from './state/store';

export default function App() {
  const boot = useGenesis((s) => s.boot);
  const mobilePanel = useGenesis((s) => s.mobilePanel);
  const isMobile = useIsMobile();

  useEffect(() => {
    boot(1337, 10_000);
  }, [boot]);

  return (
    <div className={`app ${isMobile ? 'mobile' : ''}`}>
      <CityScene />

      {!isMobile && (
        <>
          <Dashboard />
          <SearchBox />
          <TimeControls />
          <EventFeed />
          <LawsPanel />
          <VenueLegend />
          <div className="hint">
            Arraste para mover · Scroll para zoom · Clique em um habitante para ver sua vida
          </div>
        </>
      )}

      {isMobile && (
        <>
          <MobileTopBar />
          {/* painéis em bottom-sheet, um por vez (controlados pela barra de abas) */}
          {mobilePanel === 'stats' && <Dashboard />}
          {mobilePanel === 'busca' && <SearchBox />}
          <LawsPanel />
          <TimeControls />
          <MobileTabBar />
        </>
      )}

      {/* Ficha do cidadão: bottom-sheet no celular, painel lateral no desktop */}
      <CitizenPanel />
    </div>
  );
}
