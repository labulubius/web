"use client";

import { useState } from "react";
import "./cloudcli.css";

export function CloudCLIFrame() {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [generation, setGeneration] = useState(0);

  return (
    <section className="cloudcli-page" aria-label="CloudCLI workspace">
      {!loaded && (
        <div className="cloudcli-status" role={failed ? "alert" : "status"}>
          <p>{failed ? "CloudCLI could not be loaded. Check the connection and try again." : "Loading CloudCLI…"}</p>
          {failed && <button type="button" onClick={() => {
            setFailed(false);
            setLoaded(false);
            setGeneration((current) => current + 1);
          }}>Retry CloudCLI</button>}
        </div>
      )}
      <iframe
        key={generation}
        className="cloudcli-frame"
        title="CloudCLI"
        src="https://cloudcli.labulubius.com"
        allow="clipboard-read; clipboard-write; fullscreen"
        referrerPolicy="strict-origin-when-cross-origin"
        onLoad={() => { setLoaded(true); setFailed(false); }}
        onError={() => { setLoaded(false); setFailed(true); }}
      />
    </section>
  );
}
