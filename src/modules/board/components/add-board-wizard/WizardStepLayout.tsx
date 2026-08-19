import type { ReactNode } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'
import { ArrowLeftIcon, ArrowRightIcon, type Icon } from 'phosphor-react-native'

import { Button } from '@/components/base/Button'
import { theme } from '@/constants/theme'

interface WizardStepLayoutProps {
  title: string
  description?: ReactNode
  icon: Icon
  color: string
  headerRight?: ReactNode
  footer?: ReactNode
  children: ReactNode
}

export function WizardStepLayout({
  title,
  description,
  icon: IconComponent,
  color,
  headerRight,
  footer,
  children,
}: WizardStepLayoutProps) {
  return (
    <View style={styles.fill}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.topContent}>
          <View style={styles.headerRow}>
            <View style={styles.headerTitle}>
              <IconComponent size={20} color={color} weight="duotone" />
              <Text style={styles.title} numberOfLines={2}>
                {title}
              </Text>
            </View>
            {headerRight ? <View style={styles.headerRight}>{headerRight}</View> : null}
          </View>
          {description ? <Text style={styles.description}>{description}</Text> : null}
        </View>
        <View style={styles.mainContent}>
          <View style={styles.contentStack}>{children}</View>
        </View>
      </ScrollView>
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </View>
  )
}

interface WizardNavActionsProps {
  canContinue: boolean
  onBack: () => void
  onNext: () => void
  nextLabel?: string
  testIDPrefix: string
}

export function WizardNavActions({
  canContinue,
  onBack,
  onNext,
  nextLabel = 'Next',
  testIDPrefix,
}: WizardNavActionsProps) {
  return (
    <View style={styles.actions}>
      <Button
        style={styles.action}
        label="Back"
        variant="secondary"
        icon={ArrowLeftIcon}
        onPress={onBack}
        testID={`${testIDPrefix}-back`}
      />
      <Button
        style={styles.action}
        label={nextLabel}
        icon={ArrowRightIcon}
        iconPosition="right"
        onPress={onNext}
        disabled={!canContinue}
        testID={`${testIDPrefix}-next`}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    gap: 14,
  },
  scroll: {
    flex: 1,
  },
  body: {
    flexGrow: 1,
    justifyContent: 'space-between',
    gap: 14,
    paddingBottom: 4,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerTitle: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerRight: {
    flexShrink: 0,
  },
  topContent: {
    gap: 6,
  },
  mainContent: {
    flex: 1,
    minHeight: 0,
    justifyContent: 'center',
  },
  contentStack: {
    gap: 14,
    paddingBottom: 6,
  },
  title: {
    flexShrink: 1,
    color: theme.neutral.textPrimary,
    fontSize: 20,
    fontWeight: '800',
  },
  description: {
    color: theme.neutral.textSecondary,
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 18,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
  },
  footer: {
    paddingBottom: 4,
  },
  action: {
    flex: 1,
  },
})
