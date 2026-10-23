const API = window.POLLINATOR_API || "";
const jobId = crypto.randomUUID();
const outputs = {};

async function api(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const fmtTime = (ms) =>
  ms ? new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";

// ---------- participant cards ----------

const selected = { a: false, b: false };

function setupCard(card) {
  const slot = card.dataset.slot;
  card.append(document.getElementById("card-template").content.cloneNode(true));
  card.querySelectorAll(".card-title").forEach((h) => (h.textContent = `Person ${slot.toUpperCase()}`));

  const $ = (sel) => card.querySelector(sel);
  const state = { blob: null, pollTimer: null, chosen: null };

  const show = (step) => card.querySelectorAll(".step").forEach((s) => (s.hidden = !s.classList.contains(`step-${step}`)));
  const error = (msg) => {
    $(".error").hidden = !msg;
    $(".error").textContent = msg || "";
  };
  const stopPolling = () => clearTimeout(state.pollTimer);

  $(".connect").addEventListener("click", async () => {
    error("");
    $(".connect").disabled = true;
    try {
      const { connectUrl, blob } = await api("POST", "/api/auth/start", { slot });
      state.blob = blob;
      $(".qr").replaceChildren();
      new QRCode($(".qr"), { text: connectUrl, width: 180, height: 180 });
      $(".connect-link").href = connectUrl;
      show("qr");
      const deadline = Date.now() + 5 * 60 * 1000;
      const poll = async () => {
        try {
          const res = await api("POST", "/api/auth/poll", { slot, blob: state.blob });
          state.blob = res.blob;
          if (res.authenticated) {
            $(".connected").textContent = `Connected as ${res.name}.`;
            if (!$(".name").value.trim()) $(".name").value = res.name.split(" ")[0];
            show("pick");
            loadConversations("");
            return;
          }
        } catch (err) {
          error(err.message);
        }
        if (Date.now() > deadline) {
          error("The authentication link expired. Connect again.");
          show("name");
          return;
        }
        // Each poll already waits server-side for up to 10 s.
        state.pollTimer = setTimeout(poll, 500);
      };
      state.pollTimer = setTimeout(poll, 500);
    } catch (err) {
      error(err.message);
    } finally {
      $(".connect").disabled = false;
    }
  });

  $(".cancel").addEventListener("click", () => {
    stopPolling();
    state.blob = null;
    show("name");
  });

  async function loadConversations(query) {
    error("");
    const list = $(".convos");
    list.innerHTML = `<li class="muted">Loading…</li>`;
    state.chosen = null;
    $(".use").disabled = true;
    try {
      const res = await api("POST", "/api/conversations", { slot, blob: state.blob, query });
      state.blob = res.blob;
      list.replaceChildren();
      if (!res.conversations.length) list.innerHTML = `<li class="muted">No conversations found.</li>`;
      for (const c of res.conversations) {
        const li = document.createElement("li");
        const label = document.createElement("label");
        const radio = Object.assign(document.createElement("input"), { type: "radio", name: `convo-${slot}`, value: c.id });
        radio.addEventListener("change", () => {
          state.chosen = c;
          $(".use").disabled = false;
        });
        const text = document.createElement("span");
        const title = document.createElement("strong");
        title.textContent = c.title;
        const meta = document.createElement("small");
        meta.textContent = [fmtTime(c.startTime), c.utterances ? `${c.utterances} lines` : "", c.snippet || ""].filter(Boolean).join(" · ");
        text.append(title, meta);
        label.append(radio, text);
        li.append(label);
        list.append(li);
      }
    } catch (err) {
      list.replaceChildren();
      error(err.message);
    }
  }

  $(".search").addEventListener("submit", (e) => {
    e.preventDefault();
    loadConversations($(".query").value);
  });

  $(".use").addEventListener("click", async () => {
    if (!state.chosen) return;
    error("");
    $(".use").disabled = true;
    try {
      const res = await api("POST", "/api/select", {
        slot,
        blob: state.blob,
        jobId,
        conversationId: state.chosen.id,
        displayName: $(".name").value.trim() || `Person ${slot.toUpperCase()}`,
      });
      state.blob = null; // signed out server-side; the sealed session is now useless
      $(".done-msg").textContent = `✓ "${state.chosen.title}" selected (${res.utterances} lines). Bee session signed out.`;
      show("done");
      selected[slot] = true;
      updateRunButton();
    } catch (err) {
      error(err.message);
      $(".use").disabled = false;
    }
  });
}

document.querySelectorAll(".card").forEach(setupCard);

// ---------- cross-pollination ----------

const runBtn = document.getElementById("pollinate");
const runStatus = document.getElementById("run-status");

function updateRunButton() {
  const ready = selected.a && selected.b;
  runBtn.disabled = !ready;
  runStatus.textContent = ready ? "Ready." : "Both participants need to pick a conversation.";
}

runBtn.addEventListener("click", async () => {
  runBtn.disabled = true;
  try {
    await api("POST", "/api/pollinate", { jobId });
    pollJob();
  } catch (err) {
    runStatus.textContent = err.message;
    runBtn.disabled = false;
  }
});

async function pollJob() {
  try {
    const job = await api("GET", `/api/jobs/${jobId}`);
    if (job.state === "running") {
      runStatus.textContent = `${job.step}…`;
    } else if (job.state === "done") {
      runStatus.textContent = "Done.";
      showResults(job.outputs);
      api("DELETE", `/api/jobs/${jobId}`).catch(() => {});
      return;
    } else if (job.state === "failed") {
      runStatus.textContent = `Failed: ${job.error}`;
      return;
    }
  } catch (err) {
    runStatus.textContent = err.message;
  }
  setTimeout(pollJob, 2500);
}

function showResults(out) {
  document.getElementById("results").hidden = false;
  for (const slot of ["a", "b"]) {
    outputs[slot] = out[slot];
    const el = document.querySelector(`.result[data-slot="${slot}"]`);
    const other = out[slot === "a" ? "b" : "a"].name;
    el.querySelector("h2").textContent = `For ${out[slot].name}: what ${other}'s group did differently`;
    el.querySelector(".doc").innerHTML = DOMPurify.sanitize(marked.parse(out[slot].markdown));
  }
  document.getElementById("results").scrollIntoView({ behavior: "smooth" });
}

document.querySelectorAll(".result").forEach((el) => {
  const slot = el.dataset.slot;
  el.querySelector('[data-action="md"]').addEventListener("click", () => {
    const blob = new Blob([outputs[slot].markdown], { type: "text/markdown" });
    const a = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(blob),
      download: `${outputs[slot].name.replace(/[^\w-]+/g, "_")}-differences.md`,
    });
    a.click();
    URL.revokeObjectURL(a.href);
  });
  el.querySelector('[data-action="pdf"]').addEventListener("click", () => {
    document.body.dataset.print = slot;
    window.print();
  });
});
window.addEventListener("afterprint", () => delete document.body.dataset.print);

document.getElementById("restart").addEventListener("click", () => location.reload());
