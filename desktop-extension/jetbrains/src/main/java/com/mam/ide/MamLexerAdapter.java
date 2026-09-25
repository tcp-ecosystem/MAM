package com.mam.ide;

import com.intellij.lexer.Lexer;
import com.intellij.psi.tree.IElementType;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

public final class MamLexerAdapter implements Lexer {

  public static final IElementType FRONTMATTER = new IElementType("MAM_FRONTMATTER", MamLanguage.INSTANCE);
  public static final IElementType HEADING = new IElementType("MAM_HEADING", MamLanguage.INSTANCE);
  public static final IElementType CODE = new IElementType("MAM_CODE", MamLanguage.INSTANCE);
  public static final IElementType COMMENT = new IElementType("MAM_COMMENT", MamLanguage.INSTANCE);
  public static final IElementType TEXT = new IElementType("MAM_TEXT", MamLanguage.INSTANCE);

  private CharSequence myBuffer;
  private int myEndOffset;
  private int myTokenStart;
  private int myTokenEnd;
  private IElementType myTokenType;

  @Override
  public void start(@NotNull CharSequence buffer, int startOffset, int endOffset, int initialState) {
    myBuffer = buffer;
    myEndOffset = endOffset;
    myTokenStart = startOffset;
    myTokenEnd = startOffset;
    myTokenType = null;
    advance();
  }

  @Override
  public void advance() {
    myTokenStart = myTokenEnd;
    if (myTokenEnd >= myEndOffset) {
      myTokenType = null;
      return;
    }
    int lineStart = myTokenEnd;
    int lineEnd = lineStart;
    while (lineEnd < myEndOffset && myBuffer.charAt(lineEnd) != '\n') {
      lineEnd++;
    }
    myTokenType = classify(myBuffer.subSequence(lineStart, lineEnd).toString());
    myTokenEnd = Math.min(lineEnd + 1, myEndOffset);
  }

  @Override
  public @Nullable IElementType getTokenType() {
    return myTokenType;
  }

  @Override
  public int getTokenStart() {
    return myTokenStart;
  }

  @Override
  public int getTokenEnd() {
    return myTokenEnd;
  }

  @Override
  public int getCurrentPosition() {
    return myTokenEnd;
  }

  @Override
  public int getState() {
    return 0;
  }

  private static IElementType classify(String line) {
    if (line.matches("^\\s*---\\s*$")) {
      return FRONTMATTER;
    }
    if (line.matches("^\\s*#{1,6}\\s+.*")) {
      return HEADING;
    }
    if (line.matches("^\\s*(```|~~~).*")) {
      return CODE;
    }
    if (line.matches("^\\s*<!--.*")) {
      return COMMENT;
    }
    return TEXT;
  }
}