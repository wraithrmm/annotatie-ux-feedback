// Boot: finish a sign-in if the URL carries ?code=, otherwise make sure there is a session
// (or leave for the server's sign-in page), then render the portal.

import { render } from "preact";
import "./styles.css";
import { createApi } from "./api";
import { Auth, AuthError, type AuthEnv } from "./auth";
import { App } from "./App";
import { StoreProvider } from "./store";

const SIGNED_OUT = "annotatie.signedout";

function Message(props: { title: string; text: string; action: string; onAction: () => void }) {
  return (
    <div class="center">
      <div class="card">
        <div class="brand">
          <i>A</i> Annotatie
        </div>
        <h1>{props.title}</h1>
        <p class="sub">{props.text}</p>
        <button class="btn primary lg block" type="button" onClick={props.onAction}>
          {props.action}
        </button>
      </div>
    </div>
  );
}

async function boot() {
  const root = document.getElementById("app")!;
  const origin = location.origin;
  let fetchImpl: typeof fetch = (input, init) => fetch(input, init);
  let navigate = (url: string) => location.assign(url);

  // The mock exists only in dev and e2e builds; in a production build this branch is removed.
  if (import.meta.env.DEV || import.meta.env.MODE === "e2e") {
    if (new URLSearchParams(location.search).get("mock") === "1") {
      const { createMock } = await import("./mock/server");
      const mock = createMock(origin);
      fetchImpl = mock.fetch as typeof fetch;
      navigate = mock.navigate;
      (window as unknown as { __mock: unknown }).__mock = mock.controls;
    }
  }

  const env: AuthEnv = {
    origin,
    fetch: fetchImpl,
    storage: localStorage,
    session: sessionStorage,
    navigate,
    locks: typeof navigator !== "undefined" && navigator.locks ? { request: <T,>(name: string, cb: () => Promise<T>) => navigator.locks.request(name, cb) as unknown as Promise<T> } : undefined,
  };
  const auth = new Auth(env);
  const signIn = () => {
    sessionStorage.removeItem(SIGNED_OUT);
    void auth.signIn();
  };

  try {
    const clean = await auth.handleRedirect(new URL(location.href));
    if (clean !== null) {
      history.replaceState(null, "", clean);
      sessionStorage.removeItem(SIGNED_OUT);
    }
  } catch (e) {
    history.replaceState(null, "", location.pathname + location.hash);
    const msg = e instanceof AuthError ? e.message : "Sign-in didn't finish.";
    render(<Message title="Sign-in didn't finish" text={msg} action="Sign in again" onAction={signIn} />, root);
    return;
  }

  if (!auth.hasSession()) {
    if (sessionStorage.getItem(SIGNED_OUT) || new URLSearchParams(location.search).get("signedout")) {
      render(<Message title="You're signed out" text="Sign in with your passkey to see what is waiting." action="Sign in" onAction={signIn} />, root);
    } else {
      signIn();
    }
    return;
  }

  auth.onSignedOut = () => {
    render(<Message title="Your session ended" text="Sign in again to carry on. Nothing you approved is lost." action="Sign in" onAction={signIn} />, root);
  };

  const api = createApi((path, init) => auth.fetch(origin + path, init));
  render(
    <StoreProvider api={api} auth={auth}>
      <App />
    </StoreProvider>,
    root,
  );

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch(() => undefined);
  }
}

void boot();
