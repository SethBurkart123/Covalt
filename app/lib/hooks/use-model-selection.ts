"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentInfo } from "@/python/api";
import type { ModelInfo } from "@/lib/types/chat";
import { addRecentModel } from "@/lib/utils";
import { subscribeBackendBaseUrl } from "@/lib/services/backend-url";
import {
  defaultModelKey,
  DEFAULT_SELECTION_SETTINGS,
  EMPTY_SELECTION,
  fetchChatModelSelection,
  fetchGlobalModelSelection,
  fetchModelSelectionSettings,
  isSelectionAvailable,
  normalizeSelectionSettings,
  normalizeSelectionState,
  saveChatModelSelection,
  saveGlobalModelSelection,
  saveModelSelectionSettings,
  type ModelSelectionSettings,
  type ModelSelectionState,
} from "@/lib/services/model-selection";

interface UseModelSelectionArgs {
  chatId: string | null;
  models: readonly ModelInfo[];
  modelsLoading: boolean;
  agents: readonly AgentInfo[];
  agentsLoading: boolean;
}

interface UseModelSelectionResult {
  selectedModel: string;
  selectionState: ModelSelectionState;
  selectionSettings: ModelSelectionSettings;
  setSelectedModel: (modelKey: string) => void;
  setModelOptions: (modelOptions: Record<string, unknown>) => void;
  setVariables: (variables: Record<string, unknown>) => void;
  setSelectionSettings: (settings: ModelSelectionSettings) => void;
}

function withModelKey(
  state: ModelSelectionState,
  modelKey: string,
): ModelSelectionState {
  if (state.modelKey === modelKey) return state;
  return { modelKey, modelOptions: {}, variables: {} };
}

export function useModelSelection({
  chatId,
  models,
  modelsLoading,
  agents,
  agentsLoading,
}: UseModelSelectionArgs): UseModelSelectionResult {
  const [globalState, setGlobalState] =
    useState<ModelSelectionState>(EMPTY_SELECTION);
  const [globalLoaded, setGlobalLoaded] = useState(false);
  const [selectionSettings, setSelectionSettingsState] =
    useState<ModelSelectionSettings>(DEFAULT_SELECTION_SETTINGS);
  const [selectionSettingsLoaded, setSelectionSettingsLoaded] = useState(false);
  const [chatSelection, setChatSelection] =
    useState<{ chatId: string; state: ModelSelectionState } | null>(null);
  const [chatLoaded, setChatLoaded] = useState(true);
  const chatLoadTokenRef = useRef(0);

  const globalStateRef = useRef(globalState);
  const selectionSettingsRef = useRef(selectionSettings);
  const chatSelectionRef = useRef(chatSelection);
  const chatIdRef = useRef(chatId);
  globalStateRef.current = globalState;
  selectionSettingsRef.current = selectionSettings;
  chatSelectionRef.current = chatSelection;
  chatIdRef.current = chatId;

  const loadGlobalSelection = useCallback(async () => {
    const [selectionResult, settingsResult] = await Promise.allSettled([
      fetchGlobalModelSelection(),
      fetchModelSelectionSettings(),
    ]);

    if (selectionResult.status === "fulfilled") {
      setGlobalState(selectionResult.value);
    } else {
      console.error("Failed to load global model selection:", selectionResult.reason);
    }

    if (settingsResult.status === "fulfilled") {
      setSelectionSettingsState(settingsResult.value);
    } else {
      console.error(
        "Failed to load model selection settings:",
        settingsResult.reason,
      );
    }

    setGlobalLoaded(true);
    setSelectionSettingsLoaded(true);
  }, []);

  useEffect(() => {
    void loadGlobalSelection();
    const unsubscribe = subscribeBackendBaseUrl(() => {
      setGlobalLoaded(false);
      setSelectionSettingsLoaded(false);
      void loadGlobalSelection();
    });
    return unsubscribe;
  }, [loadGlobalSelection]);

  useEffect(() => {
    const token = ++chatLoadTokenRef.current;
    if (!chatId) {
      setChatSelection(null);
      setChatLoaded(true);
      return;
    }

    setChatLoaded(false);
    fetchChatModelSelection(chatId)
      .then((next) => {
        if (chatLoadTokenRef.current !== token) return;
        setChatSelection({ chatId, state: next });
      })
      .catch((error) => {
        if (chatLoadTokenRef.current !== token) return;
        console.error("Failed to load chat model selection:", error);
        setChatSelection({ chatId, state: EMPTY_SELECTION });
      })
      .finally(() => {
        if (chatLoadTokenRef.current === token) setChatLoaded(true);
      });
  }, [chatId]);

  const activeChatState =
    chatId && chatSelection?.chatId === chatId ? chatSelection.state : EMPTY_SELECTION;
  const activeGlobalState =
    selectionSettings.mode === "fixed"
      ? selectionSettings.fixedSelection
      : globalState;
  const activeLoaded = chatId
    ? chatLoaded && chatSelection?.chatId === chatId
    : globalLoaded && selectionSettingsLoaded;
  const catalogReady = !modelsLoading && !agentsLoading;
  const activeState = chatId ? activeChatState : activeGlobalState;

  const selectedModel = useMemo(() => {
    if (!activeLoaded || !catalogReady) return activeState.modelKey;
    if (isSelectionAvailable(activeState.modelKey, models, agents)) {
      return activeState.modelKey;
    }
    return defaultModelKey(models);
  }, [activeLoaded, activeState.modelKey, agents, catalogReady, models]);

  const selectionState = useMemo(
    () => normalizeSelectionState(withModelKey(activeState, selectedModel)),
    [activeState, selectedModel],
  );

  const persistGlobal = useCallback((next: ModelSelectionState) => {
    setGlobalState(next);
    void saveGlobalModelSelection(next).catch((error) => {
      console.error("Failed to save global model selection:", error);
    });
  }, []);

  const persistSelectionSettings = useCallback((next: ModelSelectionSettings) => {
    const normalized = normalizeSelectionSettings(next);
    setSelectionSettingsState(normalized);
    void saveModelSelectionSettings(normalized).catch((error) => {
      console.error("Failed to save model selection settings:", error);
    });
  }, []);

  const persistGlobalScope = useCallback(
    (next: ModelSelectionState) => {
      const currentSettings = selectionSettingsRef.current;
      if (currentSettings.mode === "fixed") {
        persistSelectionSettings({
          ...currentSettings,
          fixedSelection: next,
        });
        return;
      }

      persistGlobal(next);
    },
    [persistGlobal, persistSelectionSettings],
  );

  const persistChat = useCallback((targetChatId: string, next: ModelSelectionState) => {
    setChatSelection({ chatId: targetChatId, state: next });
    void saveChatModelSelection(targetChatId, next).catch((error) => {
      console.error("Failed to save chat model selection:", error);
    });
  }, []);

  const readActiveSelection = useCallback((): {
    chatId: string | null;
    state: ModelSelectionState;
  } => {
    const currentChatId = chatIdRef.current;
    if (currentChatId) {
      const currentChatSelection = chatSelectionRef.current;
      const state =
        currentChatSelection?.chatId === currentChatId
          ? currentChatSelection.state
          : EMPTY_SELECTION;
      return { chatId: currentChatId, state };
    }

    const currentSettings = selectionSettingsRef.current;
    const state =
      currentSettings.mode === "fixed"
        ? currentSettings.fixedSelection
        : globalStateRef.current;
    return { chatId: null, state };
  }, []);

  const setSelectedModel = useCallback(
    (modelKey: string) => {
      if (!modelKey) return;
      const { chatId: activeChatId, state: activeState } = readActiveSelection();
      const next = normalizeSelectionState(withModelKey(activeState, modelKey));

      if (activeChatId) {
        persistChat(activeChatId, next);
        persistGlobal(next);
      } else {
        persistGlobalScope(next);
      }

      addRecentModel(modelKey);
    },
    [persistChat, persistGlobal, persistGlobalScope, readActiveSelection],
  );

  const updateActiveParameters = useCallback(
    (patch: Partial<Pick<ModelSelectionState, "modelOptions" | "variables">>) => {
      const { chatId: activeChatId, state: activeState } = readActiveSelection();
      const next = normalizeSelectionState({
        ...withModelKey(activeState, selectedModel),
        ...patch,
      });

      if (activeChatId) {
        persistChat(activeChatId, next);
        const currentGlobal = globalStateRef.current;
        if (currentGlobal.modelKey === selectedModel) {
          persistGlobal(
            normalizeSelectionState({
              ...currentGlobal,
              modelKey: selectedModel,
              ...patch,
            }),
          );
        }
        return;
      }

      persistGlobalScope(next);
    },
    [persistChat, persistGlobal, persistGlobalScope, readActiveSelection, selectedModel],
  );

  const setModelOptions = useCallback(
    (modelOptions: Record<string, unknown>) => {
      updateActiveParameters({ modelOptions });
    },
    [updateActiveParameters],
  );

  const setVariables = useCallback(
    (variables: Record<string, unknown>) => {
      updateActiveParameters({ variables });
    },
    [updateActiveParameters],
  );

  const setSelectionSettings = useCallback(
    (settings: ModelSelectionSettings) => {
      persistSelectionSettings(settings);
    },
    [persistSelectionSettings],
  );

  return {
    selectedModel,
    selectionState,
    selectionSettings,
    setSelectedModel,
    setModelOptions,
    setVariables,
    setSelectionSettings,
  };
}
