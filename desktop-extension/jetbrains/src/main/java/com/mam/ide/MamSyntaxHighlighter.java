package com.mam.ide;

import com.intellij.lexer.Lexer;
import com.intellij.openapi.editor.DefaultLanguageHighlighterColors;
import com.intellij.openapi.editor.colors.TextAttributesKey;
import com.intellij.openapi.fileTypes.SyntaxHighlighterBase;
import com.intellij.psi.tree.IElementType;
import org.jetbrains.annotations.NotNull;

import java.util.HashMap;
import java.util.Map;

public final class MamSyntaxHighlighter extends SyntaxHighlighterBase {

  public static final TextAttributesKey FRONTMATTER =
      TextAttributesKey.createTextAttributesKey("MAM_FRONTMATTER", DefaultLanguageHighlighterColors.METADATA);
  public static final TextAttributesKey HEADING =
      TextAttributesKey.createTextAttributesKey("MAM_HEADING", DefaultLanguageHighlighterColors.MARKUP_TAG);
  public static final TextAttributesKey INLINE_CODE =
      TextAttributesKey.createTextAttributesKey("MAM_INLINE_CODE", DefaultLanguageHighlighterColors.MARKUP_ATTRIBUTE);
  public static final TextAttributesKey CODE_BLOCK =
      TextAttributesKey.createTextAttributesKey("MAM_CODE_BLOCK", DefaultLanguageHighlighterColors.CONSTANT);
  public static final TextAttributesKey COMMENT =
      TextAttributesKey.createTextAttributesKey("MAM_COMMENT", DefaultLanguageHighlighterColors.LINE_COMMENT);
  public static final TextAttributesKey KEYWORD =
      TextAttributesKey.createTextAttributesKey("MAM_KEYWORD", DefaultLanguageHighlighterColors.KEYWORD);
  public static final TextAttributesKey OPERATOR =
      TextAttributesKey.createTextAttributesKey("MAM_OPERATOR", DefaultLanguageHighlighterColors.OPERATION_SIGN);

  private static final Map<IElementType, TextAttributesKey> ATTRIBUTES = new HashMap<>();

  static {
    ATTRIBUTES.put(MamLexerAdapter.FRONTMATTER, FRONTMATTER);
    ATTRIBUTES.put(MamLexerAdapter.HEADING, HEADING);
    ATTRIBUTES.put(MamLexerAdapter.CODE, CODE_BLOCK);
    ATTRIBUTES.put(MamLexerAdapter.COMMENT, COMMENT);
    ATTRIBUTES.put(MamLexerAdapter.TEXT, null);
  }

  @Override
  public @NotNull Lexer getHighlightingLexer() {
    return new MamLexerAdapter();
  }

  @Override
  public TextAttributesKey @NotNull [] getTokenHighlights(IElementType tokenType) {
    return pack(ATTRIBUTES.get(tokenType));
  }
}