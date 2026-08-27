import { Image, type ImageLoadEventData } from 'expo-image'
import { Fragment, useMemo, useState } from 'react'
import {
  Linking,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native'

import { Text } from '@/components/base/Text'
import {
  parseMarkdown,
  splitInlineRuns,
  type MarkdownAlign,
  type MarkdownBlock,
  type MarkdownInline,
} from '@/components/base/markdownTree'
import { theme } from '@/constants/theme'

interface MarkdownProps {
  /** Markdown source. Raw HTML is inert and unsafe URLs are dropped. */
  children: string
  /** Layout-level container style (margins, flex) — not visual overrides. */
  style?: StyleProp<ViewStyle>
  /** Horizontal text alignment for paragraphs and headings. Defaults to left. */
  align?: MarkdownAlign
  /** Defaults to opening the href with the OS handler. */
  onLinkPress?: (href: string) => void
}

/** Aspect ratio used until the real image reports its intrinsic size. */
const PLACEHOLDER_RATIO = 16 / 9

/** Fixed column width — RN has no table layout, so columns only line up when
 *  every cell in a column is the same width. Wide tables scroll horizontally. */
const CELL_WIDTH = 120

const openLink = (href: string) => {
  void Linking.openURL(href).catch(() => {})
}

/**
 * Renders Markdown as native React Native primitives — no WebView.
 *
 * Supports paragraphs, headings, bold/italic/strikethrough, inline and fenced
 * code, nested ordered and unordered lists, blockquotes, rules, links, images,
 * tables, and soft/hard breaks. Wide tables scroll horizontally; images fill
 * the available width and fall back to their alt text on failure.
 */
export function Markdown({ children, style, align, onLinkPress = openLink }: MarkdownProps) {
  const blocks = useMemo(() => parseMarkdown(children), [children])

  return (
    <View style={[styles.root, style]}>
      {blocks.map((block, index) => (
        <Block key={index} block={block} align={align} onLinkPress={onLinkPress} />
      ))}
    </View>
  )
}

interface BlockProps {
  block: MarkdownBlock
  align?: MarkdownAlign
  onLinkPress: (href: string) => void
}

function Block({ block, align, onLinkPress }: BlockProps) {
  switch (block.type) {
    case 'paragraph':
      return (
        <View style={styles.paragraphGroup}>
          {splitInlineRuns(block.children).map((run, index) =>
            run.kind === 'image' ? (
              <MarkdownImage key={`${run.src}:${index}`} src={run.src} alt={run.alt} />
            ) : (
              <Text key={index} style={[styles.paragraph, alignStyle(align ?? null)]}>
                {inlineNodes(run.nodes, onLinkPress)}
              </Text>
            ),
          )}
        </View>
      )

    case 'heading':
      return (
        <Text style={[styles.heading, headingStyles[block.level], alignStyle(align ?? null)]}>
          {inlineNodes(block.children, onLinkPress)}
        </Text>
      )

    case 'list':
      return (
        <View style={styles.list}>
          {block.items.map((item, index) => (
            <View key={index} style={styles.listItem}>
              <Text style={styles.listMarker}>
                {block.ordered ? `${block.start + index}.` : '•'}
              </Text>
              <View style={styles.listBody}>
                {item.map((child, childIndex) => (
                  <Block key={childIndex} block={child} align={align} onLinkPress={onLinkPress} />
                ))}
              </View>
            </View>
          ))}
        </View>
      )

    case 'quote':
      return (
        <View style={styles.quote}>
          {block.children.map((child, index) => (
            <Block key={index} block={child} align={align} onLinkPress={onLinkPress} />
          ))}
        </View>
      )

    case 'code':
      return (
        <View style={styles.codeBlock}>
          {block.language ? <Text style={styles.codeLanguage}>{block.language}</Text> : null}
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <Text style={styles.codeBlockText}>{block.value}</Text>
          </ScrollView>
        </View>
      )

    case 'rule':
      return <View style={styles.rule} />

    case 'table':
      return <Table block={block} onLinkPress={onLinkPress} />
  }
}

function Table({
  block,
  onLinkPress,
}: {
  block: Extract<MarkdownBlock, { type: 'table' }>
  onLinkPress: (href: string) => void
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={styles.table}>
        {block.header.length > 0 ? (
          <View style={[styles.tableRow, styles.tableHeaderRow]}>
            {block.header.map((cell, index) => (
              <View key={index} style={styles.tableCell}>
                <Text style={[styles.tableHeaderText, alignStyle(block.align[index])]}>
                  {inlineNodes(cell, onLinkPress)}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
        {block.rows.map((row, rowIndex) => (
          <View key={rowIndex} style={styles.tableRow}>
            {row.map((cell, index) => (
              <View key={index} style={styles.tableCell}>
                <Text style={[styles.tableCellText, alignStyle(block.align[index])]}>
                  {inlineNodes(cell, onLinkPress)}
                </Text>
              </View>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  )
}

function MarkdownImage({ src, alt }: { src: string; alt: string }) {
  const [ratio, setRatio] = useState<number | null>(null)
  const [failed, setFailed] = useState(false)

  if (failed) return <Text style={styles.imageFallback}>{alt || 'Image unavailable'}</Text>

  const onLoad = ({ source }: ImageLoadEventData) => {
    if (source.width > 0 && source.height > 0) setRatio(source.width / source.height)
  }

  return (
    <Image
      source={src}
      accessibilityLabel={alt || undefined}
      contentFit="contain"
      contentPosition="left center"
      style={[styles.image, { aspectRatio: ratio ?? PLACEHOLDER_RATIO }]}
      onLoad={onLoad}
      onError={() => setFailed(true)}
    />
  )
}

/** Inline nodes render as nested `Text` so wrapping and line height stay native. */
function inlineNodes(nodes: MarkdownInline[], onLinkPress: (href: string) => void) {
  return nodes.map((node, index) => {
    switch (node.type) {
      case 'text':
        return <Fragment key={index}>{node.value}</Fragment>
      case 'strong':
        return (
          <Text key={index} style={styles.strong}>
            {inlineNodes(node.children, onLinkPress)}
          </Text>
        )
      case 'em':
        return (
          <Text key={index} style={styles.em}>
            {inlineNodes(node.children, onLinkPress)}
          </Text>
        )
      case 'strike':
        return (
          <Text key={index} style={styles.strike}>
            {inlineNodes(node.children, onLinkPress)}
          </Text>
        )
      case 'code':
        return (
          <Text key={index} style={styles.codeInline}>
            {node.value}
          </Text>
        )
      case 'link':
        return (
          <Text
            key={index}
            style={styles.link}
            accessibilityRole="link"
            onPress={() => onLinkPress(node.href)}
          >
            {inlineNodes(node.children, onLinkPress)}
          </Text>
        )
      case 'image':
        // Images are lifted to block level by `splitInlineRuns`; inside a table
        // cell they stay inline, where alt text is the readable fallback.
        return <Fragment key={index}>{node.alt}</Fragment>
      case 'break':
        return <Fragment key={index}>{node.hard ? '\n' : ' '}</Fragment>
    }
  })
}

const alignStyle = (align: MarkdownAlign | null) => (align ? { textAlign: align } : null)

/** Heading levels are clamped to 1–6 by the parser. */
const headingStyles: Record<number, TextStyle> = {
  1: { fontSize: 20, lineHeight: 26 },
  2: { fontSize: 17, lineHeight: 23 },
  3: { fontSize: 15, lineHeight: 21 },
  4: { fontSize: 14, lineHeight: 20 },
  5: { fontSize: 13, lineHeight: 19 },
  6: { fontSize: 12, lineHeight: 18 },
}

const styles = StyleSheet.create({
  root: {
    gap: 12,
  },
  paragraphGroup: {
    gap: 8,
  },
  paragraph: {
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 21,
    color: theme.neutral.textSecondary,
  },
  heading: {
    fontWeight: '700',
    color: theme.neutral.textPrimary,
  },
  strong: {
    fontWeight: '700',
    color: theme.neutral.textPrimary,
  },
  em: {
    fontStyle: 'italic',
  },
  strike: {
    textDecorationLine: 'line-through',
    color: theme.neutral.textMuted,
  },
  link: {
    color: theme.palette.sky.color,
    textDecorationLine: 'underline',
  },
  codeInline: {
    fontFamily: 'monospace',
    fontSize: 13,
    color: theme.palette.cyan.text,
    backgroundColor: theme.neutral.surfaceDeep,
  },
  codeBlock: {
    backgroundColor: theme.neutral.surfaceDeep,
    borderWidth: 1,
    borderColor: theme.neutral.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 6,
  },
  codeLanguage: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: theme.neutral.textMuted,
    textTransform: 'uppercase',
  },
  codeBlockText: {
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 18,
    color: theme.neutral.textPrimary,
  },
  list: {
    gap: 6,
  },
  listItem: {
    flexDirection: 'row',
    gap: 8,
  },
  listMarker: {
    minWidth: 18,
    textAlign: 'right',
    fontSize: 14,
    lineHeight: 21,
    color: theme.neutral.textMuted,
  },
  listBody: {
    flex: 1,
    gap: 6,
  },
  quote: {
    paddingLeft: 12,
    borderLeftWidth: 2,
    borderLeftColor: theme.palette.sky.border,
    gap: 8,
  },
  rule: {
    height: 1,
    backgroundColor: theme.neutral.border,
  },
  table: {
    borderWidth: 1,
    borderColor: theme.neutral.border,
    borderRadius: 8,
    overflow: 'hidden',
  },
  tableRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: theme.neutral.border,
  },
  tableHeaderRow: {
    borderTopWidth: 0,
    backgroundColor: theme.neutral.surfaceDeep,
  },
  tableCell: {
    width: CELL_WIDTH,
    flexShrink: 0,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  tableHeaderText: {
    fontSize: 12,
    fontWeight: '700',
    color: theme.neutral.textPrimary,
  },
  tableCellText: {
    fontSize: 13,
    fontWeight: '500',
    color: theme.neutral.textSecondary,
  },
  image: {
    width: '100%',
    borderRadius: 8,
    backgroundColor: theme.neutral.surfaceDeep,
  },
  imageFallback: {
    fontSize: 13,
    fontStyle: 'italic',
    color: theme.neutral.textMuted,
  },
})
