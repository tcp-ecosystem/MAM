package com.mam.ide;

import com.intellij.lang.annotation.AnnotationBuilder;
import com.intellij.lang.annotation.AnnotationHolder;
import com.intellij.lang.annotation.Annotator;
import com.intellij.lang.annotation.HighlightSeverity;
import com.intellij.openapi.diagnostic.Logger;
import com.intellij.openapi.util.TextRange;
import com.intellij.psi.PsiElement;
import com.intellij.psi.PsiFile;
import org.jetbrains.annotations.NotNull;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;

public final class MamAnnotator implements Annotator {

  private static final Logger LOG = Logger.getInstance(MamAnnotator.class);

  @Override
  public void annotate(@NotNull PsiElement element, @NotNull AnnotationHolder holder) {
    if (!(element instanceof PsiFile)) {
      return;
    }
    PsiFile file = (PsiFile) element;
    if (file.getFileType() != MamFileType.INSTANCE) {
      return;
    }
    String path = file.getVirtualFile() != null ? file.getVirtualFile().getPath() : null;
    if (path == null) {
      return;
    }
    try {
      Process process = new ProcessBuilder("mam", "validate", path).start();
      String stderr = readAll(process.getErrorStream());
      readAll(process.getInputStream());
      int exitCode = process.waitFor();
      if (exitCode != 0 && !stderr.isEmpty()) {
        for (String message : stderr.split("\\R")) {
          if (message.isBlank()) {
            continue;
          }
          AnnotationBuilder builder = holder.newAnnotation(HighlightSeverity.ERROR, message.trim());
          builder.range(new TextRange(0, 0)).create();
        }
      }
    } catch (IOException | InterruptedException e) {
      LOG.warn("Failed to run 'mam validate' for " + path, e);
    }
  }

  private static String readAll(InputStream stream) throws IOException {
    StringBuilder builder = new StringBuilder();
    try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
      String line;
      while ((line = reader.readLine()) != null) {
        builder.append(line).append('\n');
      }
    }
    return builder.toString();
  }
}