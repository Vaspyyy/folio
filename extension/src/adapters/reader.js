const CHANNEL = "folio:juicebox:v1";
export function validReaderState(state) {
  return (
    state &&
    Number.isInteger(state.total) &&
    state.total > 0 &&
    state.total <= 1000000 &&
    Number.isInteger(state.page) &&
    state.page >= 1 &&
    state.page <= state.total
  );
}
export function juiceboxRequest(action, page) {
  return new Promise((resolve) => {
    const id = crypto.randomUUID();
    const finish = (state) => {
      clearTimeout(timer);
      window.removeEventListener("message", listener);
      resolve(validReaderState(state) ? state : null);
    };
    const listener = (event) => {
      if (
        event.source === window &&
        event.origin === location.origin &&
        event.data?.channel === CHANNEL &&
        event.data.direction === "response" &&
        event.data.id === id
      )
        finish(event.data.state);
    };
    const timer = setTimeout(() => finish(null), 2500);
    window.addEventListener("message", listener);
    window.postMessage(
      { channel: CHANNEL, direction: "request", id, action, page },
      location.origin,
    );
  });
}
