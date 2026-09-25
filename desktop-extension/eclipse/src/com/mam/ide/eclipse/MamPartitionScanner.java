package com.mam.ide.eclipse;

import org.eclipse.jface.text.rules.EndOfLineRule;
import org.eclipse.jface.text.rules.IPredicateRule;
import org.eclipse.jface.text.rules.IToken;
import org.eclipse.jface.text.rules.MultiLineRule;
import org.eclipse.jface.text.rules.RuleBasedPartitionScanner;
import org.eclipse.jface.text.rules.Token;

public class MamPartitionScanner extends RuleBasedPartitionScanner {

  public static final String MAM_FRONTMATTER = "__mam_frontmatter";
  public static final String MAM_CODE = "__mam_code";
  public static final String MAM_COMMENT = "__mam_comment";

  public MamPartitionScanner() {
    IToken frontmatter = new Token(MAM_FRONTMATTER);
    IToken code = new Token(MAM_CODE);
    IToken comment = new Token(MAM_COMMENT);

    IPredicateRule[] rules = new IPredicateRule[] {
        new MultiLineRule("---", "---", frontmatter, (char) 0, true),
        new MultiLineRule("```", "```", code, (char) 0, true),
        new EndOfLineRule("<!--", comment),
    };
    setPredicateRules(rules);
  }
}