package com.mam.ide.eclipse;

import org.eclipse.core.resources.IFile;
import org.eclipse.core.resources.IMarker;
import org.eclipse.core.resources.IProject;
import org.eclipse.core.resources.IResource;
import org.eclipse.core.resources.IncrementalProjectBuilder;
import org.eclipse.core.runtime.CoreException;
import org.eclipse.core.runtime.IProgressMonitor;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

public class MamBuilder extends IncrementalProjectBuilder {

  public static final String BUILDER_ID = "com.mam.ide.eclipse.builder";
  public static final String MARKER_TYPE = "com.mam.ide.eclipse.marker";

  @Override
  protected IProject[] build(int kind, Map<String, String> args, IProgressMonitor monitor) throws CoreException {
    IProject project = getProject();
    project.deleteMarkers(MARKER_TYPE, true, IResource.DEPTH_INFINITE);
    if (kind == FULL_BUILD || kind == INCREMENTAL_BUILD || kind == AUTO_BUILD) {
      project.accept(resource -> {
        if (resource instanceof IFile && isMamFile((IFile) resource)) {
          validate((IFile) resource);
        }
        return true;
      });
    }
    return null;
  }

  private static boolean isMamFile(IFile file) {
    String extension = file.getFileExtension();
    return "mam".equalsIgnoreCase(extension)
        || ("md".equalsIgnoreCase(extension) && file.getName().endsWith(".mam.md"));
  }

  private void validate(IFile file) {
    try {
      Process process = new ProcessBuilder("mam", "validate", file.getLocation().toOSString()).start();
      String stderr = readAll(process.getErrorStream());
      String stdout = readAll(process.getInputStream());
      int exitCode = process.waitFor();
      if (exitCode != 0) {
        String message = stderr.isBlank() ? stdout : stderr;
        addErrorMarker(file, message.trim());
      }
    } catch (IOException | InterruptedException e) {
      addErrorMarker(file, "mam validate could not run: " + e.getMessage());
    }
  }

  private static void addErrorMarker(IFile file, String message) {
    try {
      IMarker marker = file.createMarker(MARKER_TYPE);
      Map<String, Object> attributes = new HashMap<>();
      attributes.put(IMarker.SEVERITY, IMarker.SEVERITY_ERROR);
      attributes.put(IMarker.MESSAGE, message);
      attributes.put(IMarker.LINE_NUMBER, 1);
      marker.setAttributes(attributes);
    } catch (CoreException e) {
      // ignore
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