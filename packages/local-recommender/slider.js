import { exploration } from "./profile.js";

/** A native keyboard-accessible control. The caller owns persistence and reranking. */
export function createExploreSlider({
  document,
  value = 0.25,
  onChange = () => {},
}) {
  exploration(value);
  if (typeof onChange !== "function")
    throw new TypeError("onChange must be a function");
  const element = document.createElement("label");
  const label = document.createElement("span");
  label.textContent = "Familiar ↔ Explore";
  const input = document.createElement("input");
  input.type = "range";
  input.min = "0";
  input.max = "100";
  input.step = "1";
  input.setAttribute("aria-label", "Familiar to Explore");
  const output = document.createElement("output");
  const display = () => {
    output.textContent = `${input.value}% Explore`;
    input.setAttribute(
      "aria-valuetext",
      `${input.value}% Explore, ${100 - Number(input.value)}% Familiar`,
    );
  };
  const setValue = (next) => {
    input.value = String(Math.round(exploration(next) * 100));
    display();
  };
  setValue(value);
  const onInput = () => {
    display();
    onChange(Number(input.value) / 100);
  };
  input.addEventListener("input", onInput);
  element.append(label, input, output);
  return {
    element,
    input,
    setValue,
    destroy() {
      input.removeEventListener("input", onInput);
      element.remove();
    },
  };
}
