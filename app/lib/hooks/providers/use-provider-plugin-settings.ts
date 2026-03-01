import { useCallback, useEffect, useState } from 'react';
import type {
  ProviderPluginIndexInfo,
  ProviderPluginPolicy,
  SaveProviderPluginPolicyInput,
} from '@/python/api';
import {
  addProviderPluginIndex,
  getProviderPluginPolicy,
  importProviderPlugin,
  installProviderPluginFromRepo,
  listProviderPluginIndexes,
  removeProviderPluginIndex,
  runProviderPluginUpdateCheck,
  saveProviderPluginPolicy,
} from '@/python/api';

interface UseProviderPluginSettingsState {
  policy: ProviderPluginPolicy;
  indexes: ProviderPluginIndexInfo[];
  errorByKey: Record<string, string>;
  isRunningUpdateCheck: boolean;
  indexName: string;
  indexUrl: string;
  isAddingIndex: boolean;
  repoUrl: string;
  repoRef: string;
  repoPath: string;
  isInstallingRepo: boolean;
  isUploading: boolean;
}

interface UseProviderPluginSettingsActions {
  setIndexName: (value: string) => void;
  setIndexUrl: (value: string) => void;
  setRepoUrl: (value: string) => void;
  setRepoRef: (value: string) => void;
  setRepoPath: (value: string) => void;
  handleSavePolicy: (next: ProviderPluginPolicy) => Promise<void>;
  handleRunUpdateCheck: () => Promise<void>;
  handleAddIndex: () => Promise<void>;
  handleRemoveIndex: (indexId: string) => Promise<void>;
  handleInstallRepo: () => Promise<void>;
  handleUploadZip: (file: File | null) => Promise<void>;
}

export function useProviderPluginSettings(): UseProviderPluginSettingsState &
  UseProviderPluginSettingsActions {
  const [policy, setPolicy] = useState<ProviderPluginPolicy>({
    mode: 'safe',
    autoUpdateEnabled: false,
  });
  const [indexes, setIndexes] = useState<ProviderPluginIndexInfo[]>([]);
  const [errorByKey, setErrorByKey] = useState<Record<string, string>>({});
  const [isRunningUpdateCheck, setIsRunningUpdateCheck] = useState(false);
  const [indexName, setIndexName] = useState('');
  const [indexUrl, setIndexUrl] = useState('');
  const [isAddingIndex, setIsAddingIndex] = useState(false);
  const [repoUrl, setRepoUrl] = useState('');
  const [repoRef, setRepoRef] = useState('main');
  const [repoPath, setRepoPath] = useState('');
  const [isInstallingRepo, setIsInstallingRepo] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [policyResp, indexesResp] = await Promise.all([
        getProviderPluginPolicy(),
        listProviderPluginIndexes(),
      ]);
      setPolicy(policyResp);
      setIndexes(indexesResp.indexes || []);
      setErrorByKey((prev) => ({ ...prev, global: '' }));
    } catch (error) {
      setErrorByKey((prev) => ({
        ...prev,
        global: error instanceof Error ? error.message : 'Failed to load plugin settings',
      }));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const toPolicyInput = (next: ProviderPluginPolicy): SaveProviderPluginPolicyInput => ({
    mode: next.mode === 'unsafe' ? 'unsafe' : 'safe',
    autoUpdateEnabled: Boolean(next.autoUpdateEnabled),
  });

  const handleSavePolicy = useCallback(async (next: ProviderPluginPolicy) => {
    setErrorByKey((prev) => ({ ...prev, policy: '' }));
    try {
      const saved = await saveProviderPluginPolicy({ body: toPolicyInput(next) });
      setPolicy(saved);
    } catch (error) {
      setErrorByKey((prev) => ({
        ...prev,
        policy: error instanceof Error ? error.message : 'Failed to save policy',
      }));
    }
  }, []);

  const handleRunUpdateCheck = useCallback(async () => {
    setIsRunningUpdateCheck(true);
    setErrorByKey((prev) => ({ ...prev, update: '' }));
    try {
      await runProviderPluginUpdateCheck();
      await reload();
    } catch (error) {
      setErrorByKey((prev) => ({
        ...prev,
        update: error instanceof Error ? error.message : 'Failed to run update check',
      }));
    } finally {
      setIsRunningUpdateCheck(false);
    }
  }, [reload]);

  const handleAddIndex = useCallback(async () => {
    if (!indexName.trim() || !indexUrl.trim()) {
      setErrorByKey((prev) => ({ ...prev, index: 'Index name and URL are required' }));
      return;
    }

    setIsAddingIndex(true);
    setErrorByKey((prev) => ({ ...prev, index: '' }));
    try {
      await addProviderPluginIndex({ body: { name: indexName.trim(), url: indexUrl.trim() } });
      setIndexName('');
      setIndexUrl('');
      await reload();
    } catch (error) {
      setErrorByKey((prev) => ({
        ...prev,
        index: error instanceof Error ? error.message : 'Failed to add index',
      }));
    } finally {
      setIsAddingIndex(false);
    }
  }, [indexName, indexUrl, reload]);

  const handleRemoveIndex = useCallback(
    async (indexId: string) => {
      setErrorByKey((prev) => ({ ...prev, [`index:${indexId}`]: '' }));
      try {
        await removeProviderPluginIndex({ body: { id: indexId } });
        await reload();
      } catch (error) {
        setErrorByKey((prev) => ({
          ...prev,
          [`index:${indexId}`]: error instanceof Error ? error.message : 'Failed to remove index',
        }));
      }
    },
    [reload],
  );

  const handleInstallRepo = useCallback(async () => {
    if (!repoUrl.trim()) {
      setErrorByKey((prev) => ({ ...prev, repo: 'Repository URL is required' }));
      return;
    }

    setIsInstallingRepo(true);
    setErrorByKey((prev) => ({ ...prev, repo: '' }));
    try {
      await installProviderPluginFromRepo({
        body: {
          repoUrl: repoUrl.trim(),
          ref: repoRef.trim() || 'main',
          pluginPath: repoPath.trim() || undefined,
        },
      });
      setRepoUrl('');
      setRepoPath('');
    } catch (error) {
      setErrorByKey((prev) => ({
        ...prev,
        repo: error instanceof Error ? error.message : 'Failed to install repo plugin',
      }));
    } finally {
      setIsInstallingRepo(false);
    }
  }, [repoPath, repoRef, repoUrl]);

  const handleUploadZip = useCallback(async (file: File | null) => {
    if (!file) return;

    setIsUploading(true);
    setErrorByKey((prev) => ({ ...prev, upload: '' }));
    try {
      await importProviderPlugin({ file }).promise;
    } catch (error) {
      setErrorByKey((prev) => ({
        ...prev,
        upload: error instanceof Error ? error.message : 'Failed to upload plugin',
      }));
    } finally {
      setIsUploading(false);
    }
  }, []);

  return {
    policy,
    indexes,
    errorByKey,
    isRunningUpdateCheck,
    indexName,
    indexUrl,
    isAddingIndex,
    repoUrl,
    repoRef,
    repoPath,
    isInstallingRepo,
    isUploading,
    setIndexName,
    setIndexUrl,
    setRepoUrl,
    setRepoRef,
    setRepoPath,
    handleSavePolicy,
    handleRunUpdateCheck,
    handleAddIndex,
    handleRemoveIndex,
    handleInstallRepo,
    handleUploadZip,
  };
}
