package org.ngxramblers.walking;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class SiteResourceWebViewClientTest {
    private static final String SITE = "https://group.example.org.uk";
    private static final String SHELL = "https://localhost";

    @Test
    public void allowsDocumentsTheSelectedSiteCreatedForItsOwnFrames() {
        assertTrue(SiteResourceWebViewClient.embeddedDocumentFrom("blob:https://group.example.org.uk/0d3c7a52-1c1e-4f6b-9a55-7f0f3f1f2a10", SITE, SHELL));
    }

    @Test
    public void allowsDocumentsTheLocalShellCreatedForItsOwnFrames() {
        assertTrue(SiteResourceWebViewClient.embeddedDocumentFrom("blob:https://localhost/0d3c7a52-1c1e-4f6b-9a55-7f0f3f1f2a10", "", SHELL));
    }

    @Test
    public void refusesDocumentsCreatedByAnotherSite() {
        assertFalse(SiteResourceWebViewClient.embeddedDocumentFrom("blob:https://other.example.org.uk/0d3c7a52-1c1e-4f6b-9a55-7f0f3f1f2a10", SITE, SHELL));
        assertFalse(SiteResourceWebViewClient.embeddedDocumentFrom("blob:https://group.example.org.uk.other.example/0d3c7a52", SITE, SHELL));
    }

    @Test
    public void refusesOtherSchemesAndMissingAddresses() {
        assertFalse(SiteResourceWebViewClient.embeddedDocumentFrom("mailto:alex.reed@example.com", SITE, SHELL));
        assertFalse(SiteResourceWebViewClient.embeddedDocumentFrom(null, SITE, SHELL));
        assertFalse(SiteResourceWebViewClient.embeddedDocumentFrom("blob:/0d3c7a52", "", ""));
    }
}
