export async function request(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...payload });
  if (!response?.ok)
    throw new Error(
      response?.error || "The library is unavailable. Reload this tab.",
    );
  return response.value;
}
