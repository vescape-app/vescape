import { useState } from 'react'
import { DevSettings, Pressable, StyleSheet, View } from 'react-native'
import { router } from 'expo-router'
import * as Updates from 'expo-updates'
import {
  ArrowsClockwiseIcon,
  CameraRotateIcon,
  EyeSlashIcon,
  ListBulletsIcon,
  NavigationArrowIcon,
  RecordIcon,
  SwatchesIcon,
  ToolboxIcon,
  type Icon,
} from 'phosphor-react-native'

import { Text } from '@/components/base/Text'
import { isDevelopmentApp } from '@/config/appVariant'
import { showDevControls } from '@/config/env'
import { theme } from '@/constants/theme'
import { useBleStore } from '@/modules/board/store/bleStore'
import { routes } from '@/navigation/routes'

const DEV_BADGE_HIDE_MS = 60_000

// @parity /src/app/settings/dev.tsx `DEV_PAGE_SHORTCUTS`
const DEV_PAGE_SHORTCUTS = [
  {
    label: 'Components library',
    route: routes.settingsComponents,
    icon: SwatchesIcon,
    iconColor: theme.palette.purple.color,
  },
  {
    label: 'Debug recordings',
    route: routes.settingsDebugRecordings,
    icon: RecordIcon,
    iconColor: theme.status.warning.color,
  },
  {
    label: 'Navigation diagnostics',
    route: routes.settingsNavigationDiagnostic,
    icon: NavigationArrowIcon,
    iconColor: theme.palette.sky.color,
  },
  {
    label: 'Camera playground',
    route: routes.devMapPlayground,
    icon: CameraRotateIcon,
    iconColor: theme.palette.violet.color,
  },
  {
    label: 'Other',
    route: routes.settingsOther,
    icon: ToolboxIcon,
    iconColor: theme.palette.amber.color,
  },
] as const

async function reloadRuntime() {
  try {
    await Updates.reloadAsync()
  } catch {
    DevSettings.reload()
  }
}

/** Global dev-tools launcher. Renders the anchored menu; overlay placement remains the mount point's job. */
export function DevBadge() {
  const [hidden, setHidden] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const recordDebugSession = useBleStore((state) => state.recordDebugSession)
  const setRecordDebugSession = useBleStore((state) => state.setRecordDebugSession)
  if (!isDevelopmentApp || !showDevControls) return null

  if (hidden) return null

  const hide = () => {
    setExpanded(false)
    setHidden(true)
    setTimeout(() => setHidden(false), DEV_BADGE_HIDE_MS)
  }

  const go = (route: (typeof DEV_PAGE_SHORTCUTS)[number]['route']) => {
    setExpanded(false)
    router.push(route)
  }

  return (
    <View pointerEvents="box-none" style={styles.container}>
      {expanded ? (
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => setExpanded(false)}
          accessibilityRole="button"
          accessibilityLabel="Close development tools"
        />
      ) : null}
      <Pressable
        style={styles.hitArea}
        onPress={() => setExpanded((current) => !current)}
        onLongPress={hide}
        accessibilityRole="button"
        accessibilityLabel="Development tools"
        accessibilityHint="Double tap to open tools. Long press to hide for one minute."
        accessibilityState={{ expanded }}
      >
        <View style={styles.badge}>
          <Text style={styles.text}>dev</Text>
        </View>
      </Pressable>

      {expanded ? (
        <View style={styles.menu}>
          <View style={styles.shortcuts}>
            {DEV_PAGE_SHORTCUTS.map((shortcut) => (
              <Pressable
                key={shortcut.label}
                style={styles.shortcut}
                onPress={() => go(shortcut.route)}
                accessibilityRole="button"
                accessibilityLabel={shortcut.label}
              >
                <shortcut.icon size={20} color={shortcut.iconColor} weight="duotone" />
              </Pressable>
            ))}
          </View>
          <View style={styles.divider} />
          <MenuAction
            icon={ListBulletsIcon}
            label="Event log"
            onPress={() => {
              setExpanded(false)
              router.push(routes.settingsDiagnosticEvents)
            }}
          />
          <MenuAction
            icon={RecordIcon}
            label="Debug recording"
            active={recordDebugSession}
            onPress={() => setRecordDebugSession(!recordDebugSession)}
          />
          <MenuAction
            icon={ArrowsClockwiseIcon}
            label="Reload app"
            onPress={() => void reloadRuntime()}
          />
          <MenuAction icon={EyeSlashIcon} label="Hide for 1 minute" onPress={hide} />
        </View>
      ) : null}
    </View>
  )
}

function MenuAction({
  icon: IconComponent,
  label,
  onPress,
  active,
}: {
  icon: Icon
  label: string
  onPress: () => void
  active?: boolean
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.action, pressed && styles.pressed]}
      onPress={onPress}
      accessibilityRole={active === undefined ? 'button' : 'switch'}
      accessibilityLabel={label}
      accessibilityState={active === undefined ? undefined : { checked: active }}
    >
      <IconComponent
        size={16}
        color={active ? theme.status.warning.color : theme.palette.slate.textSecondary}
        weight={active ? 'fill' : 'duotone'}
      />
      <Text style={styles.actionText}>{label}</Text>
      {active === undefined ? null : <View style={[styles.dot, active && styles.dotActive]} />}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
  },
  badge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderWidth: 1,
    borderColor: theme.status.warning.color,
    borderRadius: 999,
    backgroundColor: theme.status.warning.bg,
  },
  hitArea: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  text: {
    color: theme.status.warning.text,
    fontSize: 8,
    lineHeight: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  menu: {
    position: 'absolute',
    top: 30,
    width: 246,
    padding: 8,
    gap: 2,
    borderWidth: 1,
    borderColor: theme.palette.slate.border,
    borderRadius: 12,
    backgroundColor: theme.palette.slate.surface,
  },
  shortcuts: {
    flexDirection: 'row',
    gap: 4,
  },
  shortcut: {
    width: 42,
    height: 42,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.palette.slate.surfaceDeep,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 4,
    backgroundColor: theme.palette.slate.border,
  },
  action: {
    minHeight: 36,
    paddingHorizontal: 10,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  pressed: {
    backgroundColor: theme.palette.slate.surfaceDeep,
  },
  actionText: {
    color: theme.palette.slate.textPrimary,
    fontSize: 13,
    fontWeight: '600',
  },
  dot: {
    width: 8,
    height: 8,
    marginLeft: 'auto',
    borderRadius: 999,
    backgroundColor: theme.palette.slate.border,
  },
  dotActive: {
    backgroundColor: theme.status.warning.color,
  },
})
