package com.mam.ide.eclipse;

import org.eclipse.core.runtime.CoreException;
import org.eclipse.jface.text.IDocument;
import org.eclipse.jface.text.IDocumentExtension3;
import org.eclipse.jface.text.IDocumentPartitioner;
import org.eclipse.jface.text.presentation.IPresentationReconciler;
import org.eclipse.jface.text.presentation.PresentationReconciler;
import org.eclipse.jface.text.rules.DefaultDamagerRepairer;
import org.eclipse.jface.text.rules.FastPartitioner;
import org.eclipse.jface.text.rules.IToken;
import org.eclipse.jface.text.rules.RuleBasedScanner;
import org.eclipse.jface.text.source.ISourceViewer;
import org.eclipse.jface.text.source.SourceViewerConfiguration;
import org.eclipse.swt.graphics.RGB;
import org.eclipse.ui.editors.text.TextEditor;
import org.eclipse.ui.editors.text.TextFileDocumentProvider;

public class MamEditor extends TextEditor {

  private final MamColorManager colorManager = new MamColorManager();

  public MamEditor() {
    super();
    setSourceViewerConfiguration(new MamSourceViewerConfiguration(colorManager));
    setDocumentProvider(new MamDocumentProvider());
  }

  @Override
  public void dispose() {
    colorManager.dispose();
    super.dispose();
  }

  private static class MamDocumentProvider extends TextFileDocumentProvider {

    private static final String[] CONTENT_TYPES = {
        IDocument.DEFAULT_CONTENT_TYPE,
        MamPartitionScanner.MAM_FRONTMATTER,
        MamPartitionScanner.MAM_CODE,
        MamPartitionScanner.MAM_COMMENT,
    };

    @Override
    protected IDocument createDocument(Object element) throws CoreException {
      IDocument document = super.createDocument(element);
      if (document != null) {
        IDocumentPartitioner partitioner = new FastPartitioner(new MamPartitionScanner(), CONTENT_TYPES);
        partitioner.connect(document);
        document.setDocumentPartitioner(partitioner);
      }
      return document;
    }
  }

  private static class MamSourceViewerConfiguration extends SourceViewerConfiguration {

    private final MamColorManager colorManager;

    MamSourceViewerConfiguration(MamColorManager colorManager) {
      this.colorManager = colorManager;
    }

    @Override
    public IPresentationReconciler getPresentationReconciler(ISourceViewer sourceViewer) {
      PresentationReconciler reconciler = new PresentationReconciler();
      reconciler.setDocumentPartitioning(IDocumentExtension3.DEFAULT_PARTITIONING);

      DefaultDamagerRepairer defaultRepairer = new DefaultDamagerRepairer(new MamDefaultScanner(colorManager));
      reconciler.setDamager(defaultRepairer, IDocument.DEFAULT_CONTENT_TYPE);
      reconciler.setRepairer(defaultRepairer, IDocument.DEFAULT_CONTENT_TYPE);

      addPartitionRepairer(reconciler, MamPartitionScanner.MAM_FRONTMATTER, MamColorManager.FRONTMATTER);
      addPartitionRepairer(reconciler, MamPartitionScanner.MAM_CODE, MamColorManager.CODE);
      addPartitionRepairer(reconciler, MamPartitionScanner.MAM_COMMENT, MamColorManager.COMMENT);

      return reconciler;
    }

    private void addPartitionRepairer(PresentationReconciler reconciler, String contentType, RGB rgb) {
      DefaultDamagerRepairer repairer = new DefaultDamagerRepairer(new PartitionScanner(colorManager.createToken(rgb)));
      reconciler.setDamager(repairer, contentType);
      reconciler.setRepairer(repairer, contentType);
    }

    @Override
    public String[] getConfiguredContentTypes(ISourceViewer sourceViewer) {
      return new String[] {
          IDocument.DEFAULT_CONTENT_TYPE,
          MamPartitionScanner.MAM_FRONTMATTER,
          MamPartitionScanner.MAM_CODE,
          MamPartitionScanner.MAM_COMMENT,
      };
    }
  }

  private static class MamDefaultScanner extends RuleBasedScanner {
    MamDefaultScanner(MamColorManager colorManager) {
      setDefaultReturnToken(colorManager.createToken(MamColorManager.DEFAULT));
    }
  }

  private static class PartitionScanner extends RuleBasedScanner {
    PartitionScanner(IToken token) {
      setDefaultReturnToken(token);
    }
  }
}