"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import { useProviderItemState } from "@/lib/hooks/providers/use-provider-item-state";
import { ProviderItemHeader } from "./provider-item-header";
import { ProviderOauthActionButton } from "./provider-oauth-action-button";
import { ProviderItemStatus } from "./provider-item-status";
import ExtraModelsInput from "./ExtraModelsInput";
import type {
  ProviderItemRowActions,
  ProviderItemRowViewModel,
} from "./provider-item.types";

interface ProviderItemProps {
  row: ProviderItemRowViewModel;
  actions: ProviderItemRowActions;
  editableName?: boolean;
  onNameChange?: (name: string) => void;
}

export default function ProviderItem({
  row,
  actions,
  editableName,
  onNameChange,
}: ProviderItemProps) {
  const {
    def,
    config,
    isConnected,
    isPluginProvider,
    connection,
    oauthStatus,
    oauthUi,
  } = row;
  const {
    saving,
    saved,
    status: connectionStatus,
    error: connectionError,
  } = connection;
  const {
    code: oauthCode,
    enterpriseDomain: oauthEnterpriseDomain,
    authenticating: oauthIsAuthenticating,
    revoking: oauthIsRevoking,
    submitting: oauthIsSubmitting,
  } = oauthUi;
  const {
    onChange,
    onSave,
    onTestConnection,
    onUninstall,
    onOauthCodeChange,
    onOauthEnterpriseDomainChange,
    onOauthStart,
    onOauthSubmitCode,
    onOauthRevoke,
    onOauthOpenLink,
    onExtraModelsChange,
  } = actions;

  const [showUninstallDialog, setShowUninstallDialog] = useState(false);
  const [uninstalling, setUninstalling] = useState(false);

  const handleUninstallConfirm = async () => {
    if (!onUninstall) return;
    setUninstalling(true);
    try {
      await onUninstall();
    } finally {
      setUninstalling(false);
      setShowUninstallDialog(false);
    }
  };
  const {
    isOpen,
    setIsOpen,
    copiedCode,
    isOauth,
    oauthConnected,
    oauthError,
    isOauthAuthenticating,
    isOauthRevoking,
    isOauthSubmitting,
    showOauthConnected,
    isCompactOauth,
    isInlineCodeOauth,
    isDeviceOauth,
    deviceCode,
    formattedDeviceCode,
    handleCopyCode,
  } = useProviderItemState({
    def,
    isConnected,
    oauthStatus,
    oauthIsAuthenticating,
    oauthIsRevoking,
    oauthIsSubmitting,
  });

  const openAuthLink = (url: string) => {
    onOauthOpenLink(url);
  };

  const oauthStatusNode = showOauthConnected ? (
    <ProviderItemStatus tone="success" label="Connected" />
  ) : oauthStatus?.status === "pending" ? (
    <ProviderItemStatus tone="pending" label="Pending" />
  ) : oauthStatus?.status === "error" ? (
    <ProviderItemStatus tone="error" label="Failed" />
  ) : null;

  const connectionStatusNode =
    connectionStatus === "testing" ? (
      <ProviderItemStatus tone="pending" label="Testing" iconOnly />
    ) : connectionStatus === "success" ? (
      <ProviderItemStatus tone="success" label="Connected" />
    ) : connectionStatus === "error" ? (
      <ProviderItemStatus tone="error" label="Failed" />
    ) : connectionStatus === "idle" && isConnected ? (
      <ProviderItemStatus tone="success" label="Connected" />
    ) : null;

  if (isCompactOauth) {
    const authUrl = oauthStatus?.authUrl;
    return (
      <Card className="overflow-hidden border-border/70 py-2 gap-0">
        <ProviderItemHeader
          icon={def.icon}
          name={def.name}
          description={def.description}
          status={oauthStatusNode}
          truncateDescription
          action={
            <ProviderOauthActionButton
              authUrl={authUrl}
              oauthConnected={oauthConnected}
              isAuthenticating={isOauthAuthenticating}
              isRevoking={isOauthRevoking}
              providerName={def.name}
              onStart={onOauthStart}
              onRevoke={onOauthRevoke}
              onOpenLink={openAuthLink}
            />
          }
        />
        {oauthError && (
          <div className="px-4 pb-3 text-xs text-red-600 dark:text-red-500">
            {oauthError}
          </div>
        )}
      </Card>
    );
  }

  if (isInlineCodeOauth) {
    const authUrl = oauthStatus?.authUrl;
    const showCodeInput = Boolean(authUrl) && !oauthConnected;
    return (
      <Card className="overflow-hidden border-border/70 py-2 gap-0">
        <ProviderItemHeader
          icon={def.icon}
          name={def.name}
          description={def.description}
          status={oauthStatusNode}
          truncateDescription
          action={
            <ProviderOauthActionButton
              authUrl={authUrl}
              oauthConnected={oauthConnected}
              isAuthenticating={isOauthAuthenticating}
              isRevoking={isOauthRevoking}
              providerName={def.name}
              onStart={onOauthStart}
              onRevoke={onOauthRevoke}
              onOpenLink={openAuthLink}
            />
          }
        />
        {showCodeInput && (
          <div className="px-4 pt-2 pb-3 mt-2 border-t border-border/60">
            <div className="flex items-center gap-2">
              <Input
                id={`${def.key}-oauth-code`}
                type="text"
                placeholder="Paste authorization code"
                value={oauthCode || ""}
                onChange={(e) => onOauthCodeChange(e.target.value)}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={onOauthSubmitCode}
                disabled={!oauthCode || isOauthSubmitting}
              >
                {isOauthSubmitting ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  "Submit"
                )}
              </Button>
            </div>
          </div>
        )}
        {oauthError && (
          <div className="px-4 pb-3 text-xs text-red-600 dark:text-red-500">
            {oauthError}
          </div>
        )}
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden border-border/70 py-2 gap-0">
      <ProviderItemHeader
        icon={def.icon}
        name={def.name}
        description={def.description}
        status={isOauth ? oauthStatusNode : connectionStatusNode}
        collapsible
        isOpen={isOpen}
        onToggle={() => setIsOpen(!isOpen)}
      />

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 270, damping: 30 }}
            className="overflow-hidden"
          >
            <div className="px-2 border-t border-border/60 pt-2 space-y-2 mt-2">
              {editableName && onNameChange && (
                <div className="space-y-2">
                  <Label htmlFor={`${def.key}-custom-name`}>Display Name</Label>
                  <Input
                    id={`${def.key}-custom-name`}
                    type="text"
                    placeholder="My Custom Provider"
                    value={def.name}
                    onChange={(e) => onNameChange(e.target.value)}
                  />
                </div>
              )}

              {!isOauth &&
                def.fields.map((field) => (
                  <div className="space-y-2" key={`${def.key}-${field.id}`}>
                    <Label htmlFor={`${def.key}-${field.id}`}>
                      {field.label}
                    </Label>
                    <Input
                      id={`${def.key}-${field.id}`}
                      type={field.type}
                      placeholder={field.placeholder}
                      value={(config[field.id] as string) || ""}
                      onChange={(e) => onChange(field.id, e.target.value)}
                    />
                  </div>
                ))}

              {isOauth && def.oauth?.enterpriseDomain && (
                <div className="space-y-2">
                  <Label htmlFor={`${def.key}-enterprise-domain`}>
                    Enterprise domain (optional)
                  </Label>
                  <Input
                    id={`${def.key}-enterprise-domain`}
                    type="text"
                    placeholder="company.ghe.com"
                    value={oauthEnterpriseDomain || ""}
                    onChange={(e) =>
                      onOauthEnterpriseDomainChange(e.target.value)
                    }
                  />
                </div>
              )}

              {isOauth &&
                oauthStatus?.authUrl &&
                (!isDeviceOauth || !oauthConnected) &&
                (isDeviceOauth ? (
                  <div className="rounded-md border border-border/60 px-3 py-3 text-xs text-muted-foreground">
                    <div className="flex items-center justify-between">
                      <div className="font-medium text-foreground">
                        Verification code
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleCopyCode}
                        disabled={!deviceCode}
                      >
                        {copiedCode ? "Copied" : "Copy"}
                      </Button>
                    </div>
                    <div className="mt-2 text-2xl font-semibold text-foreground font-mono tracking-[0.35em]">
                      {formattedDeviceCode || "--- ---"}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-md border border-border/60 px-3 py-2 text-xs text-muted-foreground">
                    <div className="font-medium text-foreground">
                      Sign-in link
                    </div>
                    <div className="break-all mt-1">{oauthStatus.authUrl}</div>
                    {oauthStatus.instructions && (
                      <div className="mt-2">{oauthStatus.instructions}</div>
                    )}
                    <div className="mt-3 flex justify-end">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          oauthStatus.authUrl &&
                          openAuthLink(oauthStatus.authUrl)
                        }
                      >
                        Open link
                      </Button>
                    </div>
                  </div>
                ))}

              {isOauth && !isDeviceOauth && (
                <div className="space-y-2">
                  <Label htmlFor={`${def.key}-oauth-code`}>
                    Authorization code
                  </Label>
                  <Input
                    id={`${def.key}-oauth-code`}
                    type="text"
                    placeholder="Paste the authorization code or redirect URL"
                    value={oauthCode || ""}
                    onChange={(e) => onOauthCodeChange(e.target.value)}
                  />
                </div>
              )}

              {onExtraModelsChange && (
                <div className="space-y-2 pt-1 border-t border-border/60 mt-1">
                  <div>
                    <Label className="text-sm font-medium">Extra Models</Label>
                    <p className="text-xs text-muted-foreground">
                      Force models that aren&apos;t listed by the provider
                    </p>
                  </div>
                  <ExtraModelsInput
                    models={
                      ((config.extra as Record<string, unknown>)
                        ?.extraModels as string[]) ?? []
                    }
                    onChange={onExtraModelsChange}
                  />
                </div>
              )}

              <div className="flex flex-col gap-2 pt-1">
                {!isOauth &&
                  connectionError &&
                  connectionStatus === "error" && (
                    <div className="text-xs text-red-600 dark:text-red-500 px-1">
                      {connectionError}
                    </div>
                  )}
                {isOauth && oauthError && (
                  <div className="text-xs text-red-600 dark:text-red-500 px-1">
                    {oauthError}
                  </div>
                )}
                <div className="flex items-center justify-end gap-2">
                  {!isOauth && (
                    <>
                      {isPluginProvider && onUninstall && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setShowUninstallDialog(true)}
                          className="text-destructive hover:text-destructive"
                        >
                          Uninstall
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={onTestConnection}
                        disabled={connectionStatus === "testing"}
                      >
                        {connectionStatus === "testing" ? (
                          <>
                            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                            Testing...
                          </>
                        ) : (
                          "Test Connection"
                        )}
                      </Button>

                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={onSave}
                        disabled={saving}
                      >
                        {saving ? "Saving…" : saved ? "Saved" : "Save"}
                      </Button>
                    </>
                  )}
                  {isOauth && (
                    <>
                      {!isDeviceOauth && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={onOauthSubmitCode}
                          disabled={!oauthCode || isOauthSubmitting}
                        >
                          {isOauthSubmitting ? (
                            <>
                              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                              Submitting...
                            </>
                          ) : (
                            "Submit Code"
                          )}
                        </Button>
                      )}
                      <ProviderOauthActionButton
                        authUrl={oauthStatus?.authUrl}
                        oauthConnected={oauthConnected}
                        isAuthenticating={isOauthAuthenticating}
                        isRevoking={isOauthRevoking}
                        providerName={def.name}
                        onStart={onOauthStart}
                        onRevoke={onOauthRevoke}
                        onOpenLink={openAuthLink}
                        idleLabel={isDeviceOauth ? "Sign in" : "Start Sign-in"}
                        connectedLabel={isDeviceOauth ? "Sign out" : "Revoke"}
                        revokingLabel={
                          isDeviceOauth ? "Signing out..." : "Revoking..."
                        }
                      />
                    </>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <Dialog open={showUninstallDialog} onOpenChange={setShowUninstallDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Uninstall {def.name}?</DialogTitle>
            <DialogDescription>
              This will remove the provider and all associated configuration.
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowUninstallDialog(false)}
              disabled={uninstalling}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleUninstallConfirm}
              disabled={uninstalling}
            >
              {uninstalling ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Uninstalling...
                </>
              ) : (
                "Uninstall"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
