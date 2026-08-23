"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Siren, Loader2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
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
import { useIntegrationCapability } from "@/lib/hooks/use-integrations"
import { SettingUnavailableBadge } from "@/components/settings/setting-unavailable"
import {
  SettingBlock,
  SettingCard,
  SettingGroup,
} from "@/components/settings/setting-row"
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
  // The alerting domain from the capability registry: provider name for the badge, and
  // `configured` – the flag that decides whether this switch may be flipped at all.
  // Null while the answer is outstanding.
  const alertingCapability = useIntegrationCapability("alerting")

  const providerName = alertingCapability?.display_name ?? null
  // No provider, no switch. The access key lives in the server configuration, not in a
  // field on this page – so switching this on without one only puts a dead «Aufgebot
  // senden» button on the board, and the failure shows up days later, mid-incident.
  // Until the registry has answered we do not claim either way: the switch stays as it is.
  const notConfigured = alertingCapability !== null && !alertingCapability.configured

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
    <SettingCard
      title={
        <span className="flex flex-wrap items-center gap-2">
          <Siren className="size-4 text-primary" />
          {t("cardTitle")}
          {providerName && (
            <Badge variant="outline" className="font-normal">
              {providerName}
            </Badge>
          )}
          {notConfigured && (
            <SettingUnavailableBadge>{t("notConfiguredBadge")}</SettingUnavailableBadge>
          )}
        </span>
      }
      subtitle={
        <>
          {t("cardDescription")}
          {notConfigured && <span className="mt-1 block">{t("notConfiguredHint")}</span>}
        </>
      }
      action={
        <Switch
          aria-label={t("cardTitle")}
          checked={enabled}
          title={blockedReason ?? (notConfigured ? t("notConfiguredHint") : undefined)}
          disabled={Boolean(blockedReason) || notConfigured || !isEditor || saving === ENABLED_KEY}
          onCheckedChange={(v) => updateSetting(ENABLED_KEY, v ? "true" : "false")}
        />
      }
    >
      {blockedReason && (
        <p
          role="note"
          className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm leading-relaxed"
        >
          {blockedReason}
        </p>
      )}

      {enabled && (
        <SettingGroup
          className="mt-0 border-t-0 pt-0"
          title={t("templatesLabel")}
          hint={t.rich("templatesHint", {
            code: (chunks) => <code className="font-mono">{chunks}</code>,
          })}
        >
          {templateFields.map((field) => {
            const value = settings[field.key] !== undefined ? settings[field.key] : field.fallback
            const isCurrentlySaving = saving === field.key
            return (
              <SettingBlock
                key={field.key}
                label={field.label}
                htmlFor={field.key}
                hint={field.hint}
                action={
                  <Button
                    variant="ghost"
                    size="xs"
                    className="text-muted-foreground"
                    disabled={!isEditor || isCurrentlySaving || value === field.fallback}
                    onClick={() => updateSetting(field.key, field.fallback)}
                  >
                    {t("reset")}
                  </Button>
                }
              >
                <Textarea
                  id={field.key}
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
              </SettingBlock>
            )
          })}
        </SettingGroup>
      )}

      {enabled && (
        <SettingBlock label={t("testTitle")} hint={t("testDescription")}>
          {membersError ? (
            <p className="text-sm text-destructive">{t("membersError")}</p>
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
        </SettingBlock>
      )}
    </SettingCard>
  )
}
