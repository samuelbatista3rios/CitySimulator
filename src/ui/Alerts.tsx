import { useGenesis } from '../state/store';

/** Alertas automáticos por limiar (desemprego, inflação, crime, recall…). */
export function Alerts() {
  const alerts = useGenesis((s) => s.alerts);
  if (alerts.length === 0) return null;
  return (
    <div className="alerts">
      {alerts.map((a) => (
        <div key={a.id} className={`alert ${a.level}`}>⚠️ {a.text}</div>
      ))}
    </div>
  );
}
