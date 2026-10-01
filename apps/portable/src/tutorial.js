const steps = [
  {
    title: "Your stories, everywhere.",
    intro:
      "A little space for your library, your notes, and your place in every story.",
    points: [
      [
        "Your shelf",
        "Bring your saved library from the computer, or add titles and import page images yourself.",
      ],
      [
        "Your place",
        "Keep reading on another paired device. Your progress, notes, and collections travel with you.",
      ],
      [
        "Your choice",
        "Pairing is optional. Folio also works as a library entirely on this device.",
      ],
    ],
    note: "You can revisit this guide from Devices at any time.",
  },
  {
    title: "Bring your library along.",
    intro: "Pair once, then keep your saved library in sync privately.",
    points: [
      [
        "Start on your computer",
        "In the browser extension's library, open Your devices. Enter your relay address and choose Create private library.",
      ],
      [
        "Copy your pairing code",
        "On this device, open Devices, paste the code, and choose Pair this device. Keep the code private: it grants access to your library.",
      ],
      [
        "Keep the relay reachable",
        "The relay must be running for sync. A localhost address on your computer cannot be reached from your phone.",
      ],
    ],
    note: "The relay receives encrypted library data. Page image files stay on each device.",
    relay: true,
  },
  {
    title: "Keep a story close.",
    intro: "Choose what comes with you before you lose your connection.",
    points: [
      [
        "Share its page list",
        "Open a saved title once in the computer's Folio reader, then sync. This shares the page addresses with your paired device.",
      ],
      [
        "Download on this device",
        "Open the title's details, choose Keep offline, and wait for the download to finish. Check the Offline shelf before leaving.",
      ],
      [
        "Or bring your own pages",
        "Add a title and choose Import page images. Imports stay local; import them separately on another device.",
      ],
    ],
    note: "Removing a download keeps the title, notes, and progress in your library. A failed or cancelled download keeps the previous complete copy.",
  },
  {
    title: "One more chapter.",
    intro: "Your place is saved as you read. Come back whenever you like.",
    points: [
      [
        "Read your way",
        "Swipe or use the arrows to turn pages. Open the reading controls to choose paged or continuous mode, fit, and zoom.",
      ],
      [
        "Continue anywhere",
        "Progress syncs automatically while Folio is open and connected. Offline edits sync when you reconnect. Use Sync now for an immediate handoff.",
      ],
      [
        "Make yourself at home",
        "Cover artwork is optional. Hide library conceals your shelf on screen; it is a privacy toggle, not an app lock.",
      ],
    ],
    note: "Ready for your first story? Pair your library or start on this device.",
  },
];

export async function setupTutorial(repo, { onPair, onLocal, onError }) {
  const $ = (id) => document.getElementById(id);
  const dialog = $("tutorial");
  let current = 0,
    finishing = false;
  function paint() {
    const step = steps[current];
    $("tutorial-count").textContent =
      `CHAPTER ${current + 1} OF ${steps.length}`;
    $("tutorial-title").textContent = step.title;
    $("tutorial-intro").textContent = step.intro;
    $("tutorial-note").textContent = step.note;
    $("tutorial-points").replaceChildren(
      ...step.points.map(([title, copy]) => {
        const point = document.createElement("li");
        const heading = document.createElement("h3");
        const text = document.createElement("p");
        heading.textContent = title;
        text.textContent = copy;
        point.append(heading, text);
        return point;
      }),
    );
    for (const [i, point] of [...$("tutorial-progress").children].entries()) {
      if (i === current) point.setAttribute("aria-current", "step");
      else point.removeAttribute("aria-current");
    }
    $("tutorial-relay-help").hidden = !step.relay;
    $("tutorial-relay-help").open = false;
    $("tutorial-back").disabled = current === 0;
    $("tutorial-next").hidden = current === steps.length - 1;
    $("tutorial-finish").hidden = current !== steps.length - 1;
    $("tutorial-title").focus();
  }
  function show() {
    current = 0;
    finishing = false;
    dialog.showModal();
    paint();
  }
  async function finish(action) {
    if (finishing) return;
    finishing = true;
    try {
      await repo.set("tutorialVersion", 1);
      dialog.close();
      action?.();
    } catch (error) {
      finishing = false;
      onError(error);
    }
  }
  $("tutorial-next").onclick = () => {
    current++;
    paint();
  };
  $("tutorial-back").onclick = () => {
    current--;
    paint();
  };
  $("tutorial-skip").onclick = () => finish();
  $("tutorial-pair").onclick = () => finish(onPair);
  $("tutorial-local").onclick = () => finish(onLocal);
  $("show-tutorial").onclick = show;
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    finish();
  });
  // Android's Back action closes the native dialog through the shared DOM.
  dialog.addEventListener("close", () => {
    if (!finishing) finish();
  });
  if ((await repo.get("tutorialVersion")) !== 1) show();
}
