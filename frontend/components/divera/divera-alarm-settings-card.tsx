"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Siren, Loader2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { apiClient } from "@/lib/api-client"
import { useDeploymentBlock } from "@/lib/hooks/use-deployment"
import type { ApiDiveraMemberPreview } from "@/lib/api/types"
import {
  ALARM_TITLE_KEY,
  ALARM_TEXT_KEY,
  DEFAULT_ALARM_TITLE_TEMPLATE,
  DEFAULT_ALARM_TEXT_TEMPLATE,
} from "@/lib/message-template"
import { toast } from "sonner"

const ENABLED_KEY = "alerting.enabled"

interface Props {
  settings: Record<string, string>
  serverSettings: Record<string, string>
  setSettings: React.Dispatch<React.SetStateAction<Record<string, string>>>
  updateSetting: (key: string, value: string) => void | Promise<void>
  isEditor: boolean
  saving: string | null
}

export function DiveraAlarmSettingsCard({
  settings,
  serverSettings,
  setSettings,
  updateSetting,
  isEditor,
  saving,
}: Props) {
  const t = useTranslations("divera.alarmSettings")
  const tBlocked = useTranslations("common.deploymentBlocked")
  const enabled = settings[ENABLED_KEY] === "true"
  // The master switch AND the test button are dead on a deployment whose role refuses to
  // alert — the switch because the backend overrules it, the test because a test alarm is a
  // real push to a real phone. Lock both visibly, with the reason.
  const alerting = useDeploymentBlock("alerting")
  const blockedReason = alerting.blocked ? tBlocked("alerting", { label: alerting.label ?? "" }) : null

  const templateFields = [
    {
      key: ALARM_TITLE_KEY,
      label: t("titleFieldLabel"),
      hint: t("titleFieldHint"),
      fallback: DEFAULT_ALARM_TITLE_TEMPLATE,
      rows: 2,
    },
    {
      key: ALARM_TEXT_KEY,
      label: t("textFieldLabel"),
      hint: t("textFieldHint"),
      fallback: DEFAULT_ALARM_TEXT_TEMPLATE,
      rows: 8,
    },
  ]

  // Divera members for the test-alarm recipient picker (live from Divera, so the
  // test works even before any local personnel are linked).
  const [members, setMembers] = useState<ApiDiveraMemberPreview[]>([])
  const [membersError, setMembersError] = useState(false)
  const [testId, setTestId] = useState<string>("")
  const [isTesting, setIsTesting] = useState(false)
  // Configured alerting provider from the capability registry (badge in header)
  const [providerName, setProviderName] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    apiClient
      .getIntegrations()
      .then((integrations) => {
        if (!cancelled) setProviderName(integrations.alerting.display_name)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    apiClient
      .getDiveraMembers()
      .then((list) => {
        if (!cancelled) setMembers(list)
      })
      .catch(() => {
        if (!cancelled) setMembersError(true)
      })
    return () => {
      cancelled = true
    }
  }, [enabled])

  const handleTest = async () => {
    const member = members.find((m) => String(m.divera_id) === testId)
    if (!member) {
      toast.error(t("selectPersonError"))
      return
    }
    setIsTesting(true)
    try {
      const result = await apiClient.sendDiveraTestAlarm(member.divera_id, member.name)
      if (result.success) {
        toast.success(t("testSent", { name: member.name }))
      } else {
        toast.error(result.error || t("testFailed"))
      }
    } catch {
      // request() surfaces gating/network errors itself.
    } finally {
      setIsTesting(false)
    }
  }

  return (
    <Card className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-medium flex items-center gap-2">
            <Siren className="h-4 w-4 text-primary" />
            {t("cardTitle")}
            {providerName && (
              <Badge variant="outline" className="font-normal">
                {providerName}
              </Badge>
            )}
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            {t("cardDescription")}
          </p>
        </div>
        <Switch
          checked={enabled}
          title={blockedReason ?? undefined}
          disabled={Boolean(blockedReason) || !isEditor || saving === ENABLED_KEY}
          onCheckedChange={(v) => updateSetting(ENABLED_KEY, v ? "true" : "false")}
        />
      </div>

      {blockedReason && (
        <p
          role="note"
          className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm leading-relaxed"
        >
          {blockedReason}
        </p>
      )}

      {enabled && (
        <div className="space-y-4">
          <div>
            <Label className="font-medium">{t("templatesLabel")}</Label>
            <p className="text-xs text-muted-foreground mt-1">
              {t.rich("templatesHint", {
                code: (chunks) => <code className="font-mono">{chunks}</code>,
              })}
            </p>
          </div>
          {templateFields.map((field) => {
            const value = settings[field.key] !== undefined ? settings[field.key] : field.fallback
            const isCurrentlySaving = saving === field.key
            return (
              <div key={field.key} className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label className="font-semibold text-muted-foreground">{field.label}</Label>
                  <Button
                    variant="ghost"
                    size="xs"
                    className="text-muted-foreground"
                    disabled={!isEditor || isCurrentlySaving || value === field.fallback}
                    onClick={() => updateSetting(field.key, field.fallback)}
                  >
                    {t("reset")}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">{field.hint}</p>
                <Textarea
                  value={value}
                  rows={field.rows}
                  className="font-mono text-xs"
                  onChange={(e) =>
                    setSettings((prev) => ({ ...prev, [field.key]: e.target.value }))
                  }
                  onBlur={(e) => {
                    if (e.target.value !== (serverSettings[field.key] ?? field.fallback)) {
                      updateSetting(field.key, e.target.value)
                    }
                  }}
                  disabled={!isEditor || isCurrentlySaving}
                />
              </div>
            )
          })}
        </div>
      )}

      {enabled && (
        <div className="space-y-1.5">
          <Label className="font-semibold text-muted-foreground">{t("testTitle")}</Label>
          <p className="text-xs text-muted-foreground">
            {t("testDescription")}
          </p>
          {membersError ? (
            <p className="text-sm text-destructive">
              {t("membersError")}
            </p>
          ) : (
            <div className="flex items-center gap-2">
              <Select value={testId} onValueChange={setTestId} disabled={!isEditor}>
                <SelectTrigger className="flex-1">
                  <SelectValue
                    placeholder={members.length ? t("selectPerson") : t("loadingMembers")}
                  />
                </SelectTrigger>
                <SelectContent>
                  {members.map((m) => (
                    <SelectItem key={m.divera_id} value={String(m.divera_id)}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                onClick={handleTest}
                title={blockedReason ?? undefined}
                disabled={Boolean(blockedReason) || !isEditor || isTesting || !testId}
              >
                {isTesting ? <Loader2 className="size-4 animate-spin" /> : <Siren className="size-4" />}
                {t("sendTest")}
              </Button>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
