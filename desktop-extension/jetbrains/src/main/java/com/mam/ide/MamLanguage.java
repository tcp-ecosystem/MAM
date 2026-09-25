package com.mam.ide;

import com.intellij.lang.Language;

public final class MamLanguage extends Language {

  public static final MamLanguage INSTANCE = new MamLanguage();

  private MamLanguage() {
    super("MAM");
  }
}