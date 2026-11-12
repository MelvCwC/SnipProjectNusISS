import { Component, OnInit, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, ValidatorFn, Validators } from '@angular/forms';
import { finalize } from 'rxjs';
import { LinksService } from './links.service';
import type { ShortLink } from './short-link';

function isHttpUrl(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false;
  }

  try {
    const url = new URL(value.trim());
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.length > 0;
  } catch {
    return false;
  }
}

const httpUrlValidator: ValidatorFn = (control) =>
  isHttpUrl(control.value) ? null : { httpUrl: true };

function isErrorBody(body: unknown): body is { error: string } {
  if (typeof body !== 'object' || body === null || !('error' in body)) {
    return false;
  }
  return typeof body.error === 'string';
}

function getErrorMessage(error: unknown, action: string): string {
  if (error instanceof HttpErrorResponse) {
    if (isErrorBody(error.error) && error.error.error.trim()) {
      return error.error.error;
    }

    if (error.status === 0) {
      return 'Unable to reach Snip. Check your connection and try again.';
    }
    return `Could not ${action}. Please try again.`;
  }

  return `Could not ${action}. Please try again.`;
}

@Component({
  selector: 'app-root',
  imports: [ReactiveFormsModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent implements OnInit {
  private readonly formBuilder = inject(FormBuilder);
  private readonly linksService = inject(LinksService);

  readonly links = signal<ShortLink[]>([]);
  readonly loading = signal(true);
  readonly submitting = signal(false);
  readonly listError = signal<string | null>(null);
  readonly submitError = signal<string | null>(null);
  readonly createdLink = signal<ShortLink | null>(null);

  readonly form = this.formBuilder.nonNullable.group({
    url: ['', [Validators.required, httpUrlValidator]],
  });

  get urlControl(): typeof this.form.controls.url {
    return this.form.controls.url;
  }

  ngOnInit(): void {
    this.loadLinks();
  }

  createLink(): void {
    if (this.submitting()) {
      return;
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.submitError.set(null);
    this.createdLink.set(null);
    const url = this.urlControl.value.trim();

    this.linksService
      .create(url)
      .pipe(finalize(() => this.submitting.set(false)))
      .subscribe({
        next: (link) => {
          this.createdLink.set(link);
          this.form.reset();
          this.loadLinks();
        },
        error: (error: unknown) => this.submitError.set(getErrorMessage(error, 'create your link')),
      });
  }

  private loadLinks(): void {
    this.loading.set(true);
    this.listError.set(null);

    this.linksService
      .list()
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (links) => this.links.set(links),
        error: (error: unknown) => this.listError.set(getErrorMessage(error, 'load your links')),
      });
  }
}
