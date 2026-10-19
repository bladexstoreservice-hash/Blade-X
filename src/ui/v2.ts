import {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SectionBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  ActionRowBuilder,
  MessageFlags,
  ButtonBuilder,
  StringSelectMenuBuilder,
  ThumbnailBuilder,
} from 'discord.js';

// ===== علم Components V2 =====
export const V2_FLAG = MessageFlags.IsComponentsV2;

export interface V2Section {
  text: string;
  accessory?: {
    type: 'thumbnail';
    url: string;
    description?: string;
  };
}

export interface V2PanelOptions {
  accentColor?: number;
  title?: string;
  description?: string;
  sections?: V2Section[];
  imageUrl?: string;
  imageDescription?: string;
  imagePosition?: 'top' | 'bottom';
  /** ✅ NEW: إدراج Separator بين الأقسام */
  separatorBetweenSections?: boolean;
  footerText?: string;
  actionRows?: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[];
  separatorBeforeActions?: boolean;
  separatorBeforeFooter?: boolean;
}

export function buildV2Panel(opts: V2PanelOptions): ContainerBuilder {
  const container = new ContainerBuilder();

  if (opts.accentColor !== undefined) {
    container.setAccentColor(opts.accentColor);
  }

  // ✅ الصورة في الأعلى
  if (opts.imageUrl && opts.imagePosition === 'top') {
    try {
      container.addMediaGalleryComponents(
        new MediaGalleryBuilder().addItems(
          new MediaGalleryItemBuilder()
            .setURL(opts.imageUrl)
            .setDescription(opts.imageDescription ?? 'image'),
        ),
      );
      container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
    } catch { /* ignore */ }
  }

  // العنوان
  if (opts.title) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`# ${opts.title}`),
    );
  }

  // الوصف
  if (opts.description) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(opts.description),
    );
  }

  // الأقسام
  if (opts.sections && opts.sections.length > 0) {
    for (let i = 0; i < opts.sections.length; i++) {
      const s = opts.sections[i];

      if (opts.separatorBetweenSections && i > 0) {
        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
      }

      if (s.accessory && s.accessory.type === 'thumbnail') {
        const sectionBuilder = new SectionBuilder()
          .addTextDisplayComponents(new TextDisplayBuilder().setContent(s.text));

        try {
          sectionBuilder.setThumbnailAccessory(
            new ThumbnailBuilder()
              .setURL(s.accessory.url)
              .setDescription(s.accessory.description ?? 'thumbnail'),
          );
          container.addSectionComponents(sectionBuilder);
          continue;
        } catch { /* fall through */ }
      }

      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(s.text));
    }
  }

  // ✅ الصورة في الأسفل
  if (opts.imageUrl && opts.imagePosition !== 'top') {
    try {
      container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
      container.addMediaGalleryComponents(
        new MediaGalleryBuilder().addItems(
          new MediaGalleryItemBuilder()
            .setURL(opts.imageUrl)
            .setDescription(opts.imageDescription ?? 'image'),
        ),
      );
    } catch { /* ignore */ }
  }

  // فاصل قبل الأزرار
  if (opts.separatorBeforeActions !== false && opts.actionRows && opts.actionRows.length > 0) {
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  }

  // الأزرار
  if (opts.actionRows) {
    for (const row of opts.actionRows) {
      container.addActionRowComponents(row as any);
    }
  }

  // الفوتر
  if (opts.footerText) {
    if (opts.separatorBeforeFooter !== false) {
      container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(1));
    }
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`-# ${opts.footerText}`),
    );
  }

  return container;
}

export interface V2Payload {
  components: [ContainerBuilder];
  flags: number;
}

export function buildV2Payload(container: ContainerBuilder): V2Payload {
  return { components: [container], flags: V2_FLAG };
}

export function isV2Available(): boolean {
  try {
    const c = new ContainerBuilder();
    return typeof c.toJSON === 'function' && typeof V2_FLAG === 'number';
  } catch {
    return false;
  }
}

export function buildButtonRows(
  buttons: ButtonBuilder[],
  perRow = 5,
): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  let currentRow = new ActionRowBuilder<ButtonBuilder>();
  for (const btn of buttons) {
    currentRow.addComponents(btn);
    if (currentRow.components.length >= perRow) {
      rows.push(currentRow);
      currentRow = new ActionRowBuilder<ButtonBuilder>();
    }
  }
  if (currentRow.components.length > 0) rows.push(currentRow);
  return rows;
}

export function buildSelectRow(
  menu: StringSelectMenuBuilder,
): ActionRowBuilder<StringSelectMenuBuilder> {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}