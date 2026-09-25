package com.mam.ide.eclipse;

import org.eclipse.jface.text.rules.IToken;
import org.eclipse.jface.text.rules.Token;
import org.eclipse.jface.text.TextAttribute;
import org.eclipse.swt.graphics.Color;
import org.eclipse.swt.graphics.RGB;
import org.eclipse.swt.widgets.Display;

import java.util.HashMap;
import java.util.Map;

public class MamColorManager {

  public static final RGB DEFAULT = new RGB(0, 0, 0);
  public static final RGB FRONTMATTER = new RGB(128, 128, 128);
  public static final RGB HEADING = new RGB(0, 0, 200);
  public static final RGB CODE = new RGB(150, 0, 150);
  public static final RGB COMMENT = new RGB(120, 120, 120);

  private final Map<RGB, Color> colorTable = new HashMap<>(10);

  public Color getColor(RGB rgb) {
    return colorTable.computeIfAbsent(rgb, key -> new Color(Display.getCurrent(), key));
  }

  public IToken createToken(RGB rgb) {
    return new Token(new TextAttribute(getColor(rgb)));
  }

  public void dispose() {
    for (Color color : colorTable.values()) {
      color.dispose();
    }
    colorTable.clear();
  }
}