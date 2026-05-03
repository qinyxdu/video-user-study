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
  const rowControllers = new Set();
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
          video.loop = false;
          video.muted = true;
          video.playsInline = true;
          video.preload = "metadata";
          video.dataset.src = encodeURI(method.video_path);
          video.dataset.rowId = row.row_id;
          video.dataset.methodId = method.method_id;
          video.dataset.position = position.key;
          ensureVideoLoaded(video);
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
    const shells = videos.map((video) => video.closest(".video-shell"));
    const playToggleButton = rowElement.querySelector(".row-play-toggle");
    const restartButton = rowElement.querySelector(".row-restart");
    const seekInput = rowElement.querySelector(".row-seek");
    const timeLabel = rowElement.querySelector(".row-time");
    const rowState = {
      rafId: 0,
      scrubbing: false,
      pendingTime: 0,
    };
    const controller = {
      rowElement,
      videos,
      shells,
      playToggleButton,
      restartButton,
      seekInput,
      timeLabel,
      rowState,
    };
    rowControllers.add(controller);

    playToggleButton?.addEventListener("click", () => {
      if (isRowPlaying(controller)) {
        pauseRow(controller);
      } else {
        void startRowPlayback(controller, getResumeTime(controller));
      }
    });

    restartButton?.addEventListener("click", () => {
      void restartRow(controller);
    });

    if (seekInput) {
      seekInput.addEventListener("input", () => {
        const duration = getRowDuration(controller);
        if (!duration) {
          return;
        }
        rowState.scrubbing = true;
        stopProgressLoop(controller);
        const nextTime = (Number(seekInput.value) / 1000) * duration;
        syncRowTime(controller, nextTime);
        updateControllerUi(controller);
      });

      seekInput.addEventListener("change", () => {
        rowState.scrubbing = false;
        if (isRowPlaying(controller)) {
          startProgressLoop(controller);
        } else {
          updateControllerUi(controller);
        }
      });
    }

    shells.forEach((shell, index) => {
      if (!shell) {
        return;
      }
      shell.addEventListener("click", () => {
        const clickedVideo = videos[index];
        if (!clickedVideo) {
          return;
        }
        ensureVideoLoaded(clickedVideo);
        if (isRowPlaying(controller)) {
          pauseRow(controller);
          return;
        }
        void startRowPlayback(controller, getResumeTime(controller, clickedVideo.currentTime || 0), clickedVideo);
      });
    });

    videos.forEach((video) => {
      video.addEventListener("loadedmetadata", () => {
        applyPendingTime(controller, video);
        updateControllerUi(controller);
      });

      video.addEventListener("timeupdate", () => {
        if (!rowState.scrubbing) {
          updateControllerUi(controller);
        }
      });

      video.addEventListener("ended", () => {
        if (video === getLeadVideo(controller)) {
          finishRowPlayback(controller);
        } else {
          updateControllerUi(controller);
        }
      });

      video.addEventListener("error", () => {
        updateControllerUi(controller);
      });
    });

    updateControllerUi(controller);
  }

  async function restartRow(controller) {
    syncRowTime(controller, 0);
    await startRowPlayback(controller, 0);
  }

  async function startRowPlayback(controller, time = 0, triggerVideo = null) {
    pauseOtherRows(controller);
    const nextTime = getResumeTime(controller, time);
    syncRowTime(controller, nextTime);

    if (triggerVideo) {
      controller.videos.forEach((video) => {
        if (video !== triggerVideo) {
          video.playbackRate = triggerVideo.playbackRate || 1;
        }
      });
    }

    const playAttempts = controller.videos.map((video) => {
      ensureVideoLoaded(video);
      try {
        return video.play();
      } catch (error) {
        return Promise.reject(error);
      }
    });

    await Promise.allSettled(playAttempts);
    startProgressLoop(controller);
    updateControllerUi(controller);
  }

  function pauseOtherRows(activeController) {
    rowControllers.forEach((controller) => {
      if (controller !== activeController && isRowPlaying(controller)) {
        pauseRow(controller);
      }
    });
  }

  function pauseRow(controller, time = null) {
    const snapshot = Number.isFinite(time) ? time : getCurrentRowTime(controller);
    controller.rowState.pendingTime = snapshot;
    stopProgressLoop(controller);
    controller.videos.forEach((video) => {
      if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
        safeSetCurrentTime(video, snapshot);
      }
      video.pause();
    });
    updateControllerUi(controller);
  }

  function finishRowPlayback(controller) {
    const duration = getRowDuration(controller);
    controller.rowState.pendingTime = duration;
    stopProgressLoop(controller);
    controller.videos.forEach((video) => {
      video.pause();
      if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
        safeSetCurrentTime(video, duration);
      }
    });
    updateControllerUi(controller);
  }

  function startProgressLoop(controller) {
    stopProgressLoop(controller);

    const tick = () => {
      if (controller.rowState.scrubbing) {
        controller.rowState.rafId = window.requestAnimationFrame(tick);
        return;
      }

      syncFollowersToLead(controller);
      updateControllerUi(controller);

      if (isRowPlaying(controller)) {
        controller.rowState.rafId = window.requestAnimationFrame(tick);
      } else {
        controller.rowState.rafId = 0;
      }
    };

    controller.rowState.rafId = window.requestAnimationFrame(tick);
  }

  function stopProgressLoop(controller) {
    if (controller.rowState.rafId) {
      window.cancelAnimationFrame(controller.rowState.rafId);
      controller.rowState.rafId = 0;
    }
  }

  function updateControllerUi(controller) {
    updateRowProgress(controller);
    updateVideoShellState(controller);
    updateRowButtons(controller);
  }

  function updateRowButtons(controller) {
    const isPlaying = isRowPlaying(controller);
    if (controller.playToggleButton) {
      controller.playToggleButton.textContent = isPlaying ? "暂停本行" : "播放本行";
    }
    if (controller.restartButton) {
      controller.restartButton.disabled = !isPlaying && getCurrentRowTime(controller) <= 0.01;
    }
  }

  function updateVideoShellState(controller) {
    const isPlaying = isRowPlaying(controller);
    controller.shells.forEach((shell) => {
      if (!shell) {
        return;
      }
      shell.classList.toggle("is-playing", isPlaying);
    });
  }

  function updateRowProgress(controller) {
    const duration = getRowDuration(controller);
    const currentTime = getCurrentRowTime(controller);

    if (controller.seekInput) {
      controller.seekInput.value = duration > 0 ? String(Math.round((currentTime / duration) * 1000)) : "0";
    }
    if (controller.timeLabel) {
      controller.timeLabel.textContent = `${formatMediaTime(currentTime)} / ${formatMediaTime(duration)}`;
    }
  }

  function syncRowTime(controller, time) {
    controller.rowState.pendingTime = Number.isFinite(time) ? time : 0;
    controller.videos.forEach((video) => {
      ensureVideoLoaded(video);
      applyPendingTime(controller, video);
    });
  }

  function applyPendingTime(controller, video) {
    if (!(video instanceof HTMLVideoElement)) {
      return;
    }
    if (!Number.isFinite(controller.rowState.pendingTime)) {
      return;
    }
    if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
      return;
    }
    safeSetCurrentTime(video, controller.rowState.pendingTime);
  }

  function safeSetCurrentTime(video, time) {
    try {
      video.currentTime = Math.max(0, time || 0);
    } catch (error) {
      // Ignore transient media-state errors while metadata is still settling.
    }
  }

  function syncFollowersToLead(controller) {
    const lead = getLeadVideo(controller);
    if (!lead || lead.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      return;
    }
    controller.rowState.pendingTime = lead.currentTime || 0;
    controller.videos.forEach((video) => {
      if (video === lead || video.readyState < HTMLMediaElement.HAVE_METADATA) {
        return;
      }
      if (Math.abs((video.currentTime || 0) - lead.currentTime) > 0.12) {
        safeSetCurrentTime(video, lead.currentTime);
      }
    });
  }

  function getLeadVideo(controller) {
    return (
      controller.videos.find((video) => !video.paused && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) ||
      controller.videos.find((video) => video.readyState >= HTMLMediaElement.HAVE_METADATA) ||
      controller.videos[0]
    );
  }

  function getRowDuration(controller) {
    const lead = getLeadVideo(controller);
    return Number.isFinite(lead?.duration) ? lead.duration : 0;
  }

  function getCurrentRowTime(controller) {
    const lead = getLeadVideo(controller);
    if (lead && Number.isFinite(lead.currentTime)) {
      return lead.currentTime;
    }
    return controller.rowState.pendingTime || 0;
  }

  function isRowPlaying(controller) {
    return controller.videos.some((video) => !video.paused && !video.ended);
  }

  function getResumeTime(controller, preferredTime = null) {
    const duration = getRowDuration(controller);
    const currentTime =
      Number.isFinite(preferredTime) && preferredTime !== null ? preferredTime : getCurrentRowTime(controller);

    if (duration > 0 && currentTime >= Math.max(duration - 0.05, 0)) {
      return 0;
    }

    return currentTime || 0;
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

  function getReferenceVideo(videos) {
    return (
      videos.find((video) => !video.paused && video.readyState >= HTMLMediaElement.HAVE_METADATA) ||
      videos.find((video) => video.readyState >= HTMLMediaElement.HAVE_METADATA) ||
      videos[0]
    );
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
