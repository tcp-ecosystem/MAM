package com.mam.ide;

import com.intellij.openapi.fileTypes.LanguageFileType;
import com.intellij.openapi.util.NlsContexts;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import javax.swing.Icon;

public final class MamFileType extends LanguageFileType {

  public static final MamFileType INSTANCE = new MamFileType();

  private MamFileType() {
    super(MamLanguage.INSTANCE);
  }

  @Override
  public @NotNull String getName() {
    return "MAM File";
  }

  @Override
  public @NotNull @NlsContexts.Label String getDescription() {
    return "MAM module file";
  }

  @Override
  public @NotNull String getDefaultExtension() {
    return "mam";
  }

  @Override
  public @Nullable Icon getIcon() {
    return null;
  }
}