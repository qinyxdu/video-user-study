(function () {
  const DIMENSIONS = [
    { key: "visual_quality", label: "Visual Quality" },
    { key: "motion_quality", label: "Motion Quality" },
    { key: "temporal_consistency", label: "Temporal Consistency" },
  ];

  const POSITIONS = [
    { key: "left", label: "左" },
    { key: "middle", label: "中" },
    { key: "right", label: "右" },
  ];

  const STORAGE_KEY = "video-study-state-v1";
  const SESSION_KEY = "video-study-session-v1";
  const config = window.STUDY_CONFIG || {};
  const submitEndpoint = String(config.submitEndpoint || "").trim();

  const data = window.STUDY_DATA;
  const root = document.getElementById("study-root");
  const participantIdInput = document.getElementById("participant-id");
  const notesInput = document.getElementById("participant-notes");
  const progressText = document.getElementById("progress-text");
  const progressFill = document.getElementById("progress-fill");
  const progressHint = document.getElementById("progress-hint");
  const submitStatus = document.getElementById("submit-status");
  const submitButton = document.getElementById("submit-button");
  const saveButton = document.getElementById("save-button");
  const exportCsvButton = document.getElementById("export-csv-button");
  const exportJsonButton = document.getElementById("export-json-button");
  const resetButton = document.getElementById("reset-button");
  const debugBanner = document.getElementById("debug-banner");
  const canSubmitToServer = submitEndpoint.length > 0;
  const pendingVideoLoads = new WeakSet();
  const isDebugMode = new URLSearchParams(window.location.search).get("debug") === "1";

  if (!data || !Array.isArray(data.groups)) {
    root.innerHTML = "<p>素材清单未加载成功，请检查 study-data.js。</p>";
    return;
  }

  const session = getOrCreateSession();
  const state = loadState();
  state.participantId = state.participantId || "";
  state.notes = state.notes || "";
  state.answers = state.answers || {};
  state.rowOrders = state.rowOrders || {};
  state.startedAt = state.startedAt || new Date().toISOString();

  participantIdInput.value = state.participantId;
  notesInput.value = state.notes;
  debugBanner.hidden = !isDebugMode;

  renderStudy();
  bindGlobalEvents();
  updateProgress();

  function getOrCreateSession() {
    const existing = localStorage.getItem(SESSION_KEY);
    if (existing) {
      return JSON.parse(existing);
    }
    const created = {
      responseId: `resp_${Date.now()}_${Math.floor(Math.random() * 1e9)}`,
      seed: `${Date.now()}-${Math.floor(Math.random() * 1e9)}`,
      createdAt: new Date().toISOString(),
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(created));
    return created;
  }

  function loadState() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }
    try {
      return JSON.parse(raw);
    } catch (error) {
      return {};
    }
  }

  function saveState() {
    state.updatedAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    updateProgress();
  }

  function renderStudy() {
    root.innerHTML = "";

    data.groups.forEach((group) => {
      const section = document.createElement("section");
      section.className = "group-section";

      const header = document.createElement("div");
      header.className = "group-header";
      header.innerHTML = `
        <div>
          <h2>${escapeHtml(group.group_title)}</h2>
          <p>${group.rows.length} 个 prompt，对应同一组 3 路视频对比。</p>
        </div>
        <div class="row-chip">时长 ${escapeHtml(group.duration_label)}</div>
      `;
      section.appendChild(header);

      const rowsGrid = document.createElement("div");
      rowsGrid.className = "rows-grid";

      group.rows.forEach((row) => {
        const orderedMethods = getOrderedMethods(row);
        const article = document.createElement("article");
        article.className = "study-row incomplete";
        article.dataset.rowId = row.row_id;

        const rowHead = document.createElement("div");
        rowHead.className = "row-head";
        rowHead.innerHTML = `
          <div>
            <div class="row-title">Prompt ${String(row.display_index).padStart(2, "0")}</div>
            <p class="row-prompt">${escapeHtml(row.prompt_text)}</p>
          </div>
          <div class="row-chip">点击任意一个视频即可同步</div>
        `;
        article.appendChild(rowHead);

        const videoGrid = document.createElement("div");
        videoGrid.className = "video-grid";

        orderedMethods.forEach((method, index) => {
          const position = POSITIONS[index];
          const card = document.createElement("div");
          card.className = "video-card";
          card.innerHTML = `
            <div class="video-label">
              <span>${position.label}侧视频</span>
              <span class="video-position">位置 ${position.label}</span>
            </div>
          `;

          const shell = document.createElement("div");
          shell.className = "video-shell";

          const video = document.createElement("video");
          video.loop = true;
          video.muted = true;
          video.playsInline = true;
          video.preload = "none";
          video.dataset.src = encodeURI(method.video_path);
          video.dataset.rowId = row.row_id;
          video.dataset.methodId = method.method_id;
          video.dataset.position = position.key;
          shell.appendChild(video);

          const overlay = document.createElement("div");
          overlay.className = "video-overlay";
          overlay.innerHTML = `<div class="play-badge">▶</div>`;
          shell.appendChild(overlay);
          card.appendChild(shell);

          if (isDebugMode) {
            const badge = document.createElement("div");
            badge.className = "method-badge";
            badge.textContent = `Method: ${method.method_id}`;
            card.appendChild(badge);
          }

          videoGrid.appendChild(card);
        });

        article.appendChild(videoGrid);

        const rowControls = document.createElement("div");
        rowControls.className = "row-controls";
        rowControls.innerHTML = `
          <button type="button" class="row-play-toggle">播放/暂停本行</button>
          <button type="button" class="ghost row-restart">重新开始</button>
          <div class="row-progress">
            <input class="row-seek" type="range" min="0" max="1000" value="0" step="1" />
            <div class="row-time">0:00 / 0:00</div>
          </div>
        `;
        article.appendChild(rowControls);

        const ratingGrid = document.createElement("div");
        ratingGrid.className = "rating-grid";
        DIMENSIONS.forEach((dimension) => {
          const fieldset = document.createElement("fieldset");
          fieldset.className = "rating-fieldset";
          fieldset.innerHTML = `<legend>${dimension.label}</legend>`;

          const optionsRow = document.createElement("div");
          optionsRow.className = "options-row";

          POSITIONS.forEach((position) => {
            const choice = document.createElement("label");
            choice.className = "choice";

            const input = document.createElement("input");
            input.type = "radio";
            input.name = `${row.row_id}__${dimension.key}`;
            input.value = position.key;
            input.dataset.rowId = row.row_id;
            input.dataset.dimension = dimension.key;

            if (state.answers[row.row_id] && state.answers[row.row_id][dimension.key] === position.key) {
              input.checked = true;
            }

            const text = document.createElement("span");
            text.textContent = position.label;

            choice.appendChild(input);
            choice.appendChild(text);
            optionsRow.appendChild(choice);
          });

          fieldset.appendChild(optionsRow);
          ratingGrid.appendChild(fieldset);
        });

        article.appendChild(ratingGrid);
        rowsGrid.appendChild(article);

        bindRowVideoSync(article);
        refreshRowCompleteness(row.row_id);
      });

      section.appendChild(rowsGrid);
      root.appendChild(section);
    });
  }

  function bindGlobalEvents() {
    root.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement) || target.type !== "radio") {
        return;
      }

      const rowId = target.dataset.rowId;
      const dimension = target.dataset.dimension;
      if (!rowId || !dimension) {
        return;
      }

      state.answers[rowId] = state.answers[rowId] || {};
      state.answers[rowId][dimension] = target.value;
      saveState();
      refreshRowCompleteness(rowId);
    });

    participantIdInput.addEventListener("input", () => {
      state.participantId = participantIdInput.value.trim();
      saveState();
    });

    notesInput.addEventListener("input", () => {
      state.notes = notesInput.value;
      saveState();
    });

    saveButton.addEventListener("click", () => {
      saveState();
      progressHint.textContent = `进度已保存，更新时间 ${formatDateTime(state.updatedAt)}。`;
    });

    submitButton.addEventListener("click", async () => {
      const incompleteCount = getIncompleteRowIds().length;
      if (incompleteCount > 0) {
        const proceed = window.confirm(`还有 ${incompleteCount} 行未完成，仍然提交吗？`);
        if (!proceed) {
          return;
        }
      }
      await submitResponse();
    });

    exportCsvButton.addEventListener("click", () => {
      const incompleteCount = getIncompleteRowIds().length;
      if (incompleteCount > 0) {
        const proceed = window.confirm(`还有 ${incompleteCount} 行未完成，仍然导出 CSV 吗？`);
        if (!proceed) {
          return;
        }
      }
      downloadFile(buildCsv(), "video-study-results.csv", "text/csv;charset=utf-8;");
    });

    exportJsonButton.addEventListener("click", () => {
      const incompleteCount = getIncompleteRowIds().length;
      if (incompleteCount > 0) {
        const proceed = window.confirm(`还有 ${incompleteCount} 行未完成，仍然导出 JSON 吗？`);
        if (!proceed) {
          return;
        }
      }
      downloadFile(JSON.stringify(buildExportPayload(), null, 2), "video-study-results.json", "application/json");
    });

    resetButton.addEventListener("click", () => {
      const confirmed = window.confirm("这会清空当前浏览器中的全部选择和随机位置映射，确定继续吗？");
      if (!confirmed) {
        return;
      }
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(SESSION_KEY);
      window.location.reload();
    });

    if (!canSubmitToServer) {
      submitButton.disabled = true;
      submitStatus.textContent = "当前未配置在线提交地址，请先在 config.js 中填入 Google Apps Script Web App URL。";
    } else if (state.lastSubmittedAt) {
      submitStatus.textContent = `上次自动提交时间 ${formatDateTime(state.lastSubmittedAt)}。`;
    } else {
      submitStatus.textContent = "当前可自动提交到 Google Sheets。";
    }
  }

  function getOrderedMethods(row) {
    const storedOrder = state.rowOrders[row.row_id];
    if (storedOrder && storedOrder.length === 3) {
      return storedOrder
        .map((methodId) => row.methods.find((method) => method.method_id === methodId))
        .filter(Boolean);
    }

    const ordered = shuffleMethodsForRow(row);

    state.rowOrders[row.row_id] = ordered.map((method) => method.method_id);
    saveState();
    return ordered;
  }

  function refreshRowCompleteness(rowId) {
    const rowElement = root.querySelector(`.study-row[data-row-id="${CSS.escape(rowId)}"]`);
    if (!rowElement) {
      return;
    }
    const answer = state.answers[rowId] || {};
    const complete = DIMENSIONS.every((dimension) => Boolean(answer[dimension.key]));
    rowElement.classList.toggle("incomplete", !complete);
  }

  function getIncompleteRowIds() {
    const incomplete = [];
    data.groups.forEach((group) => {
      group.rows.forEach((row) => {
        const answer = state.answers[row.row_id] || {};
        const complete = DIMENSIONS.every((dimension) => Boolean(answer[dimension.key]));
        if (!complete) {
          incomplete.push(row.row_id);
        }
      });
    });
    return incomplete;
  }

  function updateProgress() {
    const total = data.groups.reduce((sum, group) => sum + group.rows.length * DIMENSIONS.length, 0);
    const answered = data.groups.reduce((sum, group) => {
      return (
        sum +
        group.rows.reduce((rowSum, row) => {
          const answer = state.answers[row.row_id] || {};
          return rowSum + DIMENSIONS.filter((dimension) => Boolean(answer[dimension.key])).length;
        }, 0)
      );
    }, 0);

    progressText.textContent = `${answered} / ${total}`;
    progressFill.style.width = `${total === 0 ? 0 : (answered / total) * 100}%`;

    const incompleteRows = getIncompleteRowIds().length;
    progressHint.textContent =
      incompleteRows === 0
        ? "所有题目都已完成，可以直接导出结果。"
        : `还有 ${incompleteRows} 行待完成，页面会自动保存在当前浏览器。`;
  }

  function buildExportPayload() {
    const promptRows = [];
    const detailedChoices = [];
    const summary = {};

    data.groups.forEach((group) => {
      group.rows.forEach((row) => {
        const promptRow = buildPromptExportRow(group, row);
        promptRows.push(promptRow);

        DIMENSIONS.forEach((dimension) => {
          const selectedMethod = promptRow[`${dimension.key}_method`];
          detailedChoices.push({
            group_id: promptRow.group_id,
            group_title: promptRow.group_title,
            row_id: promptRow.row_id,
            prompt_id: promptRow.prompt_id,
            prompt_text: promptRow.prompt_text,
            dimension: dimension.key,
            dimension_label: dimension.label,
            selected_position: promptRow[`${dimension.key}_position`],
            selected_method: selectedMethod,
            left_method: promptRow.left_method,
            middle_method: promptRow.middle_method,
            right_method: promptRow.right_method,
            left_video: promptRow.left_video,
            middle_video: promptRow.middle_video,
            right_video: promptRow.right_video,
          });

          if (!summary[group.group_id]) {
            summary[group.group_id] = {};
          }
          if (!summary[group.group_id][dimension.key]) {
            summary[group.group_id][dimension.key] = {};
          }
          if (selectedMethod) {
            summary[group.group_id][dimension.key][selectedMethod] =
              (summary[group.group_id][dimension.key][selectedMethod] || 0) + 1;
          }
        });
      });
    });

    return {
      exportedAt: new Date().toISOString(),
      participantId: state.participantId || "",
      notes: state.notes || "",
      session,
      responseId: session.responseId,
      build: {
        generatedAt: data.generated_at,
        root: data.root,
      },
      prompt_rows: promptRows,
      detailed_choices: detailedChoices,
      summary,
    };
  }

  async function submitResponse() {
    if (!canSubmitToServer) {
      submitStatus.textContent = "当前未配置在线提交地址。";
      return;
    }

    submitButton.disabled = true;
    submitStatus.textContent = "正在提交结果…";

    try {
      const formData = new FormData();
      formData.append("payload", JSON.stringify(buildExportPayload()));

      await fetch(submitEndpoint, {
        method: "POST",
        mode: "no-cors",
        body: formData,
      });
      state.lastSubmittedAt = new Date().toISOString();
      state.lastSubmissionId = session.responseId;
      saveState();
      submitStatus.textContent = `提交请求已发送，时间 ${formatDateTime(state.lastSubmittedAt)}。如网络正常，结果会写入 Google Sheets。`;
    } catch (error) {
      console.error(error);
      submitStatus.textContent = "自动提交失败，请稍后重试，或先导出 JSON 备份。";
    } finally {
      submitButton.disabled = false;
    }
  }

  function buildCsv() {
    const payload = buildExportPayload();
    const headers = [
      "participant_id",
      "notes",
      "exported_at",
      "group_id",
      "group_title",
      "row_id",
      "prompt_id",
      "prompt_text",
      "left_method",
      "middle_method",
      "right_method",
      "left_video",
      "middle_video",
      "right_video",
      "visual_quality_position",
      "visual_quality_method",
      "motion_quality_position",
      "motion_quality_method",
      "temporal_consistency_position",
      "temporal_consistency_method",
    ];

    const lines = [headers.join(",")];
    payload.prompt_rows.forEach((row) => {
      const values = [
        payload.participantId,
        payload.notes,
        payload.exportedAt,
        row.group_id,
        row.group_title,
        row.row_id,
        row.prompt_id,
        row.prompt_text,
        row.left_method,
        row.middle_method,
        row.right_method,
        row.left_video,
        row.middle_video,
        row.right_video,
        row.visual_quality_position,
        row.visual_quality_method,
        row.motion_quality_position,
        row.motion_quality_method,
        row.temporal_consistency_position,
        row.temporal_consistency_method,
      ];
      lines.push(values.map(csvEscape).join(","));
    });

    return `\ufeff${lines.join("\n")}`;
  }

  function buildPromptExportRow(group, row) {
    const orderedMethods = getOrderedMethods(row);
    const methodByPosition = {
      left: orderedMethods[0],
      middle: orderedMethods[1],
      right: orderedMethods[2],
    };
    const answers = state.answers[row.row_id] || {};

    return {
      group_id: group.group_id,
      group_title: group.group_title,
      row_id: row.row_id,
      prompt_id: row.prompt_id,
      prompt_text: row.prompt_text,
      left_method: methodByPosition.left.method_id,
      middle_method: methodByPosition.middle.method_id,
      right_method: methodByPosition.right.method_id,
      left_video: methodByPosition.left.video_path,
      middle_video: methodByPosition.middle.video_path,
      right_video: methodByPosition.right.video_path,
      visual_quality_position: answers.visual_quality || "",
      visual_quality_method: getMethodIdFromPosition(methodByPosition, answers.visual_quality),
      motion_quality_position: answers.motion_quality || "",
      motion_quality_method: getMethodIdFromPosition(methodByPosition, answers.motion_quality),
      temporal_consistency_position: answers.temporal_consistency || "",
      temporal_consistency_method: getMethodIdFromPosition(methodByPosition, answers.temporal_consistency),
    };
  }

  function bindRowVideoSync(rowElement) {
    const videos = Array.from(rowElement.querySelectorAll("video"));
    const playToggleButton = rowElement.querySelector(".row-play-toggle");
    const restartButton = rowElement.querySelector(".row-restart");
    const seekInput = rowElement.querySelector(".row-seek");
    const timeLabel = rowElement.querySelector(".row-time");
    const rowState = {
      syncing: false,
      scrubbing: false,
    };

    videos.forEach(observeVideoLoad);

    if (playToggleButton) {
      playToggleButton.addEventListener("click", async () => {
        const lead = videos[0];
        ensureVideoLoaded(lead);
        if (videos.every((video) => video.paused)) {
          await playRowForGroup(videos, rowState, lead.currentTime || 0);
        } else {
          pauseRowForGroup(videos, rowState);
        }
      });
    }

    if (restartButton) {
      restartButton.addEventListener("click", async () => {
        await playRowForGroup(videos, rowState, 0);
      });
    }

    if (seekInput) {
      seekInput.addEventListener("input", () => {
        const lead = videos[0];
        const duration = lead.duration || 0;
        if (!duration) {
          return;
        }
        rowState.scrubbing = true;
        const nextTime = (Number(seekInput.value) / 1000) * duration;
        videos.forEach((video) => {
          ensureVideoLoaded(video);
          video.currentTime = nextTime;
        });
        updateRowProgress(videos, seekInput, timeLabel);
      });

      seekInput.addEventListener("change", () => {
        rowState.scrubbing = false;
      });
    }

    videos.forEach((video) => {
      video.addEventListener("click", async () => {
        ensureVideoLoaded(video);
        if (videos.every((item) => item.paused)) {
          await playRowForGroup(videos, rowState, video.currentTime || 0, video);
        } else {
          pauseRowForGroup(videos, rowState);
        }
      });

      video.addEventListener("play", async () => {
        ensureVideoLoaded(video);
        if (rowState.syncing) {
          updateVideoShellState(videos);
          return;
        }
        await playRowForGroup(videos, rowState, video.currentTime || 0, video);
      });

      video.addEventListener("pause", () => {
        if (rowState.syncing || video.ended) {
          updateVideoShellState(videos);
          return;
        }
        pauseRowForGroup(videos, rowState, video.currentTime || 0);
      });

      video.addEventListener("seeking", () => {
        if (rowState.syncing || rowState.scrubbing) {
          return;
        }
        rowState.syncing = true;
        videos.forEach((other) => {
          if (other !== video) {
            other.currentTime = video.currentTime;
          }
        });
        rowState.syncing = false;
        updateRowProgress(videos, seekInput, timeLabel);
      });

      video.addEventListener("ratechange", () => {
        if (rowState.syncing) {
          return;
        }
        rowState.syncing = true;
        videos.forEach((other) => {
          if (other !== video) {
            other.playbackRate = video.playbackRate;
          }
        });
        rowState.syncing = false;
      });

      video.addEventListener("timeupdate", () => {
        updateRowProgress(videos, seekInput, timeLabel);
        updateVideoShellState(videos);
      });

      video.addEventListener("loadedmetadata", () => {
        updateRowProgress(videos, seekInput, timeLabel);
      });

      video.addEventListener("ended", () => {
        updateVideoShellState(videos);
      });
    });

    updateRowProgress(videos, seekInput, timeLabel);
    updateVideoShellState(videos);
  }

  async function playRowForGroup(videos, rowState, time = 0, triggerVideo = null) {
    rowState.syncing = true;
    try {
      for (const video of videos) {
        ensureVideoLoaded(video);
        if (Number.isFinite(time)) {
          video.currentTime = time;
        }
        if (triggerVideo && video !== triggerVideo) {
          video.playbackRate = triggerVideo.playbackRate;
        }
      }
      await Promise.allSettled(videos.map((video) => video.play()));
    } finally {
      rowState.syncing = false;
      updateVideoShellState(videos);
    }
  }

  function pauseRowForGroup(videos, rowState, time = null) {
    rowState.syncing = true;
    videos.forEach((video) => {
      if (time !== null) {
        video.currentTime = time;
      }
      video.pause();
    });
    rowState.syncing = false;
    updateVideoShellState(videos);
  }

  function updateVideoShellState(videos) {
    videos.forEach((video) => {
      const shell = video.closest(".video-shell");
      if (!shell) {
        return;
      }
      shell.classList.toggle("is-playing", !video.paused && !video.ended);
    });
  }

  function updateRowProgress(videos, seekInput, timeLabel) {
    const lead = videos[0];
    if (!lead) {
      return;
    }
    const duration = Number.isFinite(lead.duration) ? lead.duration : 0;
    const currentTime = Number.isFinite(lead.currentTime) ? lead.currentTime : 0;

    if (seekInput) {
      seekInput.value = duration > 0 ? String(Math.round((currentTime / duration) * 1000)) : "0";
    }
    if (timeLabel) {
      timeLabel.textContent = `${formatMediaTime(currentTime)} / ${formatMediaTime(duration)}`;
    }
  }

  function getMethodIdFromPosition(methodByPosition, position) {
    if (!position || !methodByPosition[position]) {
      return "";
    }
    return methodByPosition[position].method_id;
  }

  function shuffleMethodsForRow(row) {
    const methods = [...row.methods];
    let seed = stableHash(`${session.seed}:${row.row_id}:shuffle`);
    for (let index = methods.length - 1; index > 0; index -= 1) {
      seed = nextSeed(seed);
      const swapIndex = seed % (index + 1);
      [methods[index], methods[swapIndex]] = [methods[swapIndex], methods[index]];
    }
    return methods;
  }

  function nextSeed(seed) {
    return (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  }

  function observeVideoLoad(video) {
    if (!("IntersectionObserver" in window)) {
      ensureVideoLoaded(video);
      return;
    }

    if (!window.__studyVideoObserver) {
      window.__studyVideoObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              ensureVideoLoaded(entry.target);
              window.__studyVideoObserver.unobserve(entry.target);
            }
          });
        },
        {
          rootMargin: "300px 0px",
          threshold: 0.01,
        },
      );
    }

    window.__studyVideoObserver.observe(video);
  }

  function ensureVideoLoaded(video) {
    if (!(video instanceof HTMLVideoElement)) {
      return;
    }
    if (video.src || pendingVideoLoads.has(video)) {
      return;
    }
    const source = video.dataset.src;
    if (!source) {
      return;
    }
    pendingVideoLoads.add(video);
    video.src = source;
    video.load();
    pendingVideoLoads.delete(video);
  }

  function stableHash(text) {
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function csvEscape(value) {
    const stringValue = String(value ?? "");
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  function downloadFile(content, filename, contentType) {
    const blob = new Blob([content], { type: contentType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function formatDateTime(value) {
    if (!value) {
      return "--";
    }
    return new Date(value).toLocaleString("zh-CN", { hour12: false });
  }

  function formatMediaTime(seconds) {
    if (!seconds || !Number.isFinite(seconds)) {
      return "0:00";
    }
    const whole = Math.floor(seconds);
    const mins = Math.floor(whole / 60);
    const secs = String(whole % 60).padStart(2, "0");
    return `${mins}:${secs}`;
  }

  function escapeHtml(text) {
    return String(text)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }
})();
