package com.mam.ide;

import com.intellij.openapi.editor.colors.TextAttributesKey;
import com.intellij.openapi.fileTypes.SyntaxHighlighter;
import com.intellij.openapi.options.colors.AttributesDescriptor;
import com.intellij.openapi.options.colors.ColorDescriptor;
import com.intellij.openapi.options.colors.ColorSettingsPage;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import javax.swing.Icon;
import java.util.Map;

public final class MamColorSettingsPage implements ColorSettingsPage {

  private static final AttributesDescriptor[] DESCRIPTORS = {
      new AttributesDescriptor("Front matter", MamSyntaxHighlighter.FRONTMATTER),
      new AttributesDescriptor("Heading", MamSyntaxHighlighter.HEADING),
      new AttributesDescriptor("Inline code", MamSyntaxHighlighter.INLINE_CODE),
      new AttributesDescriptor("Code block", MamSyntaxHighlighter.CODE_BLOCK),
      new AttributesDescriptor("Comment", MamSyntaxHighlighter.COMMENT),
      new AttributesDescriptor("Keyword", MamSyntaxHighlighter.KEYWORD),
      new AttributesDescriptor("Operator", MamSyntaxHighlighter.OPERATOR),
  };

  @Override
  public @Nullable Icon getIcon() {
    return null;
  }

  @Override
  public @NotNull SyntaxHighlighter getHighlighter() {
    return new MamSyntaxHighlighter();
  }

  @Override
  public @NotNull String getDemoText() {
    return "---\n" +
           "name: example\n" +
           "status: draft\n" +
           "---\n" +
           "\n" +
           "## Purpose\n" +
           "This module shows **bold**, *italic* and `inline code`.\n" +
           "\n" +
           "```mermaid\n" +
           "A -> B\n" +
           "```\n" +
           "\n" +
           "<!-- a comment -->\n";
  }

  @Override
  public @Nullable Map<String, TextAttributesKey> getAdditionalHighlightingTagToDescriptorMap() {
    return null;
  }

  @Override
  public @NotNull AttributesDescriptor[] getAttributeDescriptors() {
    return DESCRIPTORS;
  }

  @Override
  public @NotNull ColorDescriptor[] getColorDescriptors() {
    return ColorDescriptor.EMPTY_ARRAY;
  }

  @Override
  public @NotNull String getDisplayName() {
    return "MAM";
  }
}