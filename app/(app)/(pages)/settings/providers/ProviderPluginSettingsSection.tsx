import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Loader2, Plus, Plug, RefreshCw, Shield, Upload } from 'lucide-react';
import { useProviderPluginSettings } from '@/lib/hooks/providers/use-provider-plugin-settings';

export function ProviderPluginSettingsSection() {
  const {
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
  } = useProviderPluginSettings();

  return (
    <div className="space-y-5">
      {errorByKey.global && <p className="text-sm text-red-600">{errorByKey.global}</p>}

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Shield className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">Safety &amp; Updates</h3>
        </div>
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={policy.mode === 'unsafe'}
              onCheckedChange={(checked) => {
                void handleSavePolicy({ ...policy, mode: checked === true ? 'unsafe' : 'safe' });
              }}
            />
            Allow community plugins (unsafe mode)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={policy.autoUpdateEnabled}
              onCheckedChange={(checked) => {
                void handleSavePolicy({ ...policy, autoUpdateEnabled: checked === true });
              }}
            />
            Auto-update plugins
          </label>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void handleRunUpdateCheck()}
          disabled={isRunningUpdateCheck}
        >
          {isRunningUpdateCheck ? (
            <>
              <Loader2 className="mr-1.5 size-4 animate-spin" /> Checking...
            </>
          ) : (
            <>
              <RefreshCw className="mr-1.5 size-4" /> Check for updates
            </>
          )}
        </Button>
        {errorByKey.policy && <p className="text-xs text-red-600">{errorByKey.policy}</p>}
        {errorByKey.update && <p className="text-xs text-red-600">{errorByKey.update}</p>}
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-medium">Community Indexes</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <Input
            value={indexName}
            onChange={(e) => setIndexName(e.target.value)}
            placeholder="Index name"
          />
          <Input
            value={indexUrl}
            onChange={(e) => setIndexUrl(e.target.value)}
            placeholder="https://example.com/provider-index.json"
            className="md:col-span-2"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => void handleAddIndex()}
            disabled={isAddingIndex}
          >
            {isAddingIndex ? (
              <>
                <Loader2 className="mr-1.5 size-4 animate-spin" /> Adding...
              </>
            ) : (
              <>
                <Plus className="mr-1.5 size-4" /> Add index
              </>
            )}
          </Button>
          {errorByKey.index && <p className="text-xs text-red-600">{errorByKey.index}</p>}
        </div>
        {indexes.length > 0 && (
          <div className="space-y-2">
            {indexes.map((index) => (
              <div
                key={index.id}
                className="flex items-center justify-between text-sm border rounded p-2"
              >
                <div>
                  <div className="font-medium">{index.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {index.url} · {index.pluginCount} plugins
                  </div>
                </div>
                {!index.builtIn && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void handleRemoveIndex(index.id)}
                  >
                    Remove
                  </Button>
                )}
                {errorByKey[`index:${index.id}`] && (
                  <p className="text-xs text-red-600">{errorByKey[`index:${index.id}`]}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-medium">Install from GitHub</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <Input
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            placeholder="https://github.com/owner/repo"
            className="md:col-span-2"
          />
          <Input
            value={repoRef}
            onChange={(e) => setRepoRef(e.target.value)}
            placeholder="ref (default: main)"
          />
          <Input
            value={repoPath}
            onChange={(e) => setRepoPath(e.target.value)}
            placeholder="Plugin path inside repo (optional)"
            className="md:col-span-3"
          />
        </div>
        <Button
          size="sm"
          onClick={() => void handleInstallRepo()}
          disabled={isInstallingRepo}
        >
          {isInstallingRepo ? (
            <>
              <Loader2 className="mr-1.5 size-4 animate-spin" /> Installing...
            </>
          ) : (
            <>
              <Plug className="mr-1.5 size-4" /> Install
            </>
          )}
        </Button>
        {errorByKey.repo && <p className="text-xs text-red-600">{errorByKey.repo}</p>}
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-medium">Upload Plugin ZIP</h3>
        <label className="inline-flex items-center">
          <input
            type="file"
            className="hidden"
            accept=".zip,application/zip,application/x-zip-compressed"
            disabled={isUploading}
            onChange={(e) => {
              const file = e.target.files?.[0] || null;
              void handleUploadZip(file);
              e.target.value = '';
            }}
          />
          <Button variant="outline" size="sm" asChild>
            <span>
              {isUploading ? (
                <>
                  <Loader2 className="mr-1.5 size-4 animate-spin" /> Uploading...
                </>
              ) : (
                <>
                  <Upload className="mr-1.5 size-4" /> Upload ZIP
                </>
              )}
            </span>
          </Button>
        </label>
        {errorByKey.upload && <p className="text-xs text-red-600">{errorByKey.upload}</p>}
      </div>
    </div>
  );
}
