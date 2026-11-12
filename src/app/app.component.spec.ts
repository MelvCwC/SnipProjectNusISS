import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AppComponent } from './app.component';
import type { ShortLink } from './short-link';

describe('AppComponent', () => {
  let fixture: ComponentFixture<AppComponent>;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    http.expectOne({ method: 'GET', url: '/api/links' }).flush([]);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  it('rejects non-HTTP URLs without making a request', () => {
    fixture.componentInstance.form.controls.url.setValue('ftp://example.com');
    fixture.componentInstance.createLink();

    expect(fixture.componentInstance.form.controls.url.hasError('httpUrl')).toBeTrue();
    http.expectNone({ method: 'POST', url: '/api/links' });
  });

  it('creates a link, prevents duplicate submissions, and refreshes the list', () => {
    const link: ShortLink = {
      code: 'a1B2c3',
      url: 'https://example.com/page',
      shortUrl: 'http://localhost:3000/a1B2c3',
      hits: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const component = fixture.componentInstance;
    component.form.controls.url.setValue('https://example.com/page');
    component.createLink();
    component.createLink();

    const createRequest = http.expectOne('/api/links');
    expect(createRequest.request.method).toBe('POST');
    expect(createRequest.request.body).toEqual({ url: 'https://example.com/page' });
    http.expectNone((request) => request.method === 'POST');
    createRequest.flush(link);

    http.expectOne({ method: 'GET', url: '/api/links' }).flush([link]);
    fixture.detectChanges();

    expect(component.links()).toEqual([link]);
    expect(fixture.nativeElement.querySelector('.notice-success')?.textContent).toContain(link.shortUrl);
    expect(fixture.nativeElement.querySelector('tbody a')?.textContent.trim()).toBe(link.code);
  });

  it('shows the server error beside the form after a failed submission', () => {
    const component = fixture.componentInstance;
    component.form.controls.url.setValue('https://example.com/page');
    component.createLink();

    http
      .expectOne({ method: 'POST', url: '/api/links' })
      .flush({ error: 'This URL cannot be shortened.' }, { status: 400, statusText: 'Bad Request' });
    fixture.detectChanges();

    expect(component.submitting()).toBeFalse();
    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain(
      'This URL cannot be shortened.',
    );
  });
});
