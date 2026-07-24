#!/usr/bin/env python3
"""
TRF3 Crawler using DrissionPage
Tribunal Regional Federal da 3a Regiao - Jurisprudencia
https://web.trf3.jus.br/jurisprudencia/
"""

import argparse
import json
import re
import sys
import time

from DrissionPage import ChromiumPage, ChromiumOptions


class TRF3Crawler:
    BASE_URL = 'https://web.trf3.jus.br/jurisprudencia/'
    BASE_NAMES = {0: 'TRF3', 1: 'Turmas Recursais', 2: 'Monocráticas'}

    def __init__(self, headless=True, base=0):
        self.base = base
        self.headless = headless
        self.page = None
        self.results_per_page = 10

    def init(self):
        co = ChromiumOptions()
        if self.headless:
            co.headless()
        co.set_argument('--no-sandbox')
        co.set_argument('--disable-blink-features=AutomationControlled')
        co.set_user_agent(
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 '
            '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
        )
        self.page = ChromiumPage(co)

    def close(self):
        if self.page:
            self.page.quit()
            self.page = None

    def navigate_to_search(self):
        for attempt in range(1, 4):
            try:
                self.page.get(self.BASE_URL)
                time.sleep(5)
                search_input = self.page.ele('@placeholder=Digite sua Pesquisa', timeout=30)
                if search_input:
                    print('Search page loaded successfully')
                    break
                else:
                    raise Exception('Search input not found')
            except Exception as e:
                print(f'Attempt {attempt} failed: {e}. Retrying...')
                time.sleep(3)
                if attempt == 3:
                    raise

        # Select base if not default TRF3
        if self.base == 1:
            link = self.page.ele('@href=/jurisprudencia/home/index/1', timeout=5)
            if link:
                link.click()
                time.sleep(3)
        elif self.base == 2:
            link = self.page.ele('@href=/jurisprudencia/home/index/2', timeout=5)
            if link:
                link.click()
                time.sleep(3)

    def configure_filters(self, filters):
        needs_advanced = any([
            filters.get('numeroProcesso'),
            filters.get('relator'),
            filters.get('dataInicio'),
            filters.get('dataFim'),
            filters.get('classe'),
            filters.get('orgaoJulgador'),
            filters.get('ementa'),
        ])

        if needs_advanced:
            try:
                btn = self.page.ele('text:Abrir pesquisa Avançada', timeout=5)
                if btn:
                    btn.click()
                    time.sleep(0.5)
            except Exception:
                print('Advanced search may already be open')

            if filters.get('numeroProcesso'):
                try:
                    field = self.page.ele('@name=Número do Processo:', timeout=3)
                    if field:
                        field.clear()
                        field.input(filters['numeroProcesso'])
                        print(f"Set process number: {filters['numeroProcesso']}")
                except Exception as e:
                    print(f'Could not set process number: {e}')

            if filters.get('relator'):
                try:
                    select = self.page.ele('tag:select@@name=Relator(a):', timeout=3)
                    if select:
                        select.select(filters['relator'])
                        print(f"Set relator: {filters['relator']}")
                except Exception as e:
                    print(f"Could not set relator: {e}")

            if filters.get('dataInicio') or filters.get('dataFim'):
                try:
                    date_inputs = self.page.eles('tag:input@@type=text')
                    date_fields = [inp for inp in date_inputs
                                   if inp.attr('placeholder') and '/' in (inp.attr('placeholder') or '')]
                    if date_fields and filters.get('dataInicio'):
                        date_fields[0].clear()
                        date_fields[0].input(filters['dataInicio'])
                        print(f"Set start date: {filters['dataInicio']}")
                    if len(date_fields) > 1 and filters.get('dataFim'):
                        date_fields[1].clear()
                        date_fields[1].input(filters['dataFim'])
                        print(f"Set end date: {filters['dataFim']}")
                except Exception:
                    print('Could not set dates')

            if filters.get('tipoData'):
                try:
                    selects = self.page.eles('tag:select')
                    for s in selects:
                        txt = s.text or ''
                        if 'Publicação' in txt or 'Julgamento' in txt:
                            s.select(filters['tipoData'])
                            print(f"Set date type: {filters['tipoData']}")
                            break
                except Exception:
                    print('Could not set date type')

            if filters.get('classe'):
                try:
                    select = self.page.ele('tag:select@@name=Classe:', timeout=3)
                    if select:
                        select.select(filters['classe'])
                        print(f"Set classe: {filters['classe']}")
                except Exception:
                    print('Could not set classe')

            if filters.get('orgaoJulgador'):
                try:
                    select = self.page.ele('tag:select@@name=Órgão Julgador:', timeout=3)
                    if select:
                        select.select(filters['orgaoJulgador'])
                        print(f"Set orgao julgador: {filters['orgaoJulgador']}")
                except Exception:
                    print('Could not set orgao julgador')

            if filters.get('ementa'):
                try:
                    field = self.page.ele('@name=Ementa:', timeout=3)
                    if field:
                        field.clear()
                        field.input(filters['ementa'])
                        print(f"Set ementa: {filters['ementa']}")
                except Exception:
                    print('Could not set ementa')

        if filters.get('resultadosPorPagina'):
            self.results_per_page = filters['resultadosPorPagina']

    def execute_search(self, query):
        search_box = self.page.ele('@placeholder=Digite sua Pesquisa')
        search_box.click()
        search_box.clear()
        search_box.input(query)
        print(f'Set search query: {query}')

        btn = self.page.ele('text:Fazer Pesquisa', timeout=5)
        if not btn:
            btn = self.page.ele('@title=Fazer Pesquisa', timeout=3)
        if btn:
            btn.click()
        else:
            from DrissionPage.common import Keys
            search_box.input(Keys.ENTER)

        # Wait for results page
        for _ in range(30):
            time.sleep(1)
            if 'ListaResumida' in self.page.url:
                break
        time.sleep(3)

        # Set results per page if specified
        if self.results_per_page and self.results_per_page != 10:
            try:
                selects = self.page.eles('tag:select')
                for s in selects:
                    txt = s.text or ''
                    if '10' in txt and '30' in txt and '50' in txt:
                        s.select(str(self.results_per_page))
                        time.sleep(2)
                        break
            except Exception:
                print('Could not set results per page')

    def extract_results(self):
        results = []
        time.sleep(2)

        # Get all <a> links pointing to ListaColecao
        links = self.page.eles('@href:ListaColecao', timeout=10)
        result_items = []
        seen = set()
        for link in links:
            try:
                li = link.parent('tag:li')
                if li and id(li) not in seen:
                    seen.add(id(li))
                    result_items.append(li)
            except Exception:
                result_items.append(link)

        print(f'Found {len(result_items)} result items on page')

        for item in result_items:
            try:
                result = self._extract_single_result(item)
                if result and result.get('numeroProcesso'):
                    results.append(result)
            except Exception as e:
                print(f'Error extracting result: {e}')

        return results

    def _extract_single_result(self, item):
        text = item.text or ''

        numero_processo = ''
        classe = ''
        orgao_julgador = ''
        relator = ''
        data_publicacao = ''
        data_julgamento = ''
        ementa = ''

        # Process number (format: NNNNNNN-NN.NNNN.N.NN.NNNN)
        m = re.search(r'(\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4})', text)
        if m:
            numero_processo = m.group(1)

        # Classe - e.g. "ApCiv - APELAÇÃO CÍVEL"
        m = re.search(r'([A-Za-z]+\s*-\s*[A-ZÁÀÂÃÉÈÊÍÏÓÔÕÖÚÇ\s]+?)(?:\d+ª|\d+a\.|\n|Juiz|Desembargador)', text)
        if m:
            classe = m.group(1).strip()

        # Orgao julgador - e.g. "4ª Turma" or "1ª Seção"
        m = re.search(r'(\d+ª?\s*(?:Turma|Seção))', text)
        if m:
            orgao_julgador = m.group(1)

        # Relator - "RELATOR: NAME" from ementa or "Desembargador Federal NAME"
        m = re.search(r'RELATOR:\s*(.+?)(?:\n|$)', text)
        if m:
            relator = m.group(1).strip()
        else:
            m = re.search(r'Desembargador(?:a)?\s+Federal\s+(.+?)(?:\n|Intimação|DATA)', text)
            if m:
                relator = m.group(1).strip()
        if not relator:
            m = re.search(r'Juiz\s+Federal\s+(.+?)(?:\n|Intimação|DATA)', text)
            if m:
                relator = m.group(1).strip()

        # Data publicacao
        m = re.search(r'DATA:\s*(\d{2}/\d{2}/\d{4})', text)
        if m:
            data_publicacao = m.group(1)

        # Data julgamento
        m = re.search(r'Julgamento:\s*(\d{2}/\d{2}/\d{4})', text)
        if m:
            data_julgamento = m.group(1)

        # Ementa
        m = re.search(r'((?:PODER JUDICIÁRIO|E\s*M\s*E\s*N\s*T\s*A|Ementa).+)', text, re.DOTALL)
        if m:
            ementa = m.group(1).strip()
        elif len(text) > 200:
            ementa = text[-500:]

        return {
            'numeroProcesso': numero_processo,
            'classe': classe,
            'orgaoJulgador': orgao_julgador,
            'relator': relator,
            'dataPublicacao': data_publicacao,
            'dataJulgamento': data_julgamento,
            'ementa': ementa[:15000],
        }

    def has_next_page(self):
        try:
            # Pagination uses links with class "muda-pagina"
            # Current page has class "muda-pagina atual"
            result = self.page.run_js('''
                var current = document.querySelector('a.muda-pagina.atual');
                if (!current) return false;
                var currentNum = parseInt(current.textContent.trim());
                // Check if there's a page link with a higher number
                var pages = document.querySelectorAll('a.muda-pagina:not(.atual)');
                for (var i = 0; i < pages.length; i++) {
                    var num = parseInt(pages[i].textContent.trim());
                    if (!isNaN(num) && num > currentNum) return true;
                }
                return false;
            ''')
            return bool(result)
        except Exception:
            return False

    def go_to_next_page(self):
        # Get first result to verify content changes
        first_proc = self.page.run_js('''
            var links = document.querySelectorAll('a[href*="ListaColecao"]');
            if (links.length > 0) {
                var match = links[0].textContent.match(/(\\d{7}-\\d{2}\\.\\d{4}\\.\\d\\.\\d{2}\\.\\d{4})/);
                return match ? match[1] : '';
            }
            return '';
        ''')

        # Click the next page number link
        self.page.run_js('''
            var current = document.querySelector('a.muda-pagina.atual');
            if (!current) return;
            var currentNum = parseInt(current.textContent.trim());
            var nextNum = currentNum + 1;
            var pages = document.querySelectorAll('a.muda-pagina');
            for (var i = 0; i < pages.length; i++) {
                var num = parseInt(pages[i].textContent.trim());
                if (num === nextNum) {
                    pages[i].click();
                    return;
                }
            }
        ''')

        # Wait for content to change
        for _ in range(15):
            time.sleep(1)
            new_proc = self.page.run_js('''
                var links = document.querySelectorAll('a[href*="ListaColecao"]');
                if (links.length > 0) {
                    var match = links[0].textContent.match(/(\\d{7}-\\d{2}\\.\\d{4}\\.\\d\\.\\d{2}\\.\\d{4})/);
                    return match ? match[1] : '';
                }
                return '';
            ''')
            if new_proc and new_proc != first_proc:
                break
        time.sleep(1)

    def get_total_results(self):
        try:
            # Look for pattern "N ~ TOTAL" in any element
            page_text = self.page.html
            m = re.search(r'(\d+)\s*~\s*(\d+)', page_text)
            if m:
                return int(m.group(2))
        except Exception:
            pass
        return None

    def search(self, query, filters=None, max_pages=10):
        filters = filters or {}
        all_results = []
        current_page = 1

        try:
            self.init()
            self.navigate_to_search()
            self.configure_filters(filters)
            self.execute_search(query)

            total = self.get_total_results()
            if total is not None:
                print(f'Total results found: {total}')

            while current_page <= max_pages:
                print(f'Extracting results from page {current_page}...')
                results = self.extract_results()
                all_results.extend(results)
                print(f'Found {len(results)} results on page {current_page}')

                if not self.has_next_page() or current_page >= max_pages:
                    break

                self.go_to_next_page()
                current_page += 1

            return all_results
        finally:
            self.close()


def main():
    parser = argparse.ArgumentParser(
        description='TRF3 Jurisprudencia Crawler (DrissionPage)')
    parser.add_argument('-q', '--query', required=True, help='Search query')
    parser.add_argument('-di', '--data-inicio', help='Start date (DD/MM/YYYY)')
    parser.add_argument('-df', '--data-fim', help='End date (DD/MM/YYYY)')
    parser.add_argument('-td', '--tipo-data', default='Publicação',
                        help='Date type: Publicação or Julgamento')
    parser.add_argument('-r', '--relator', help='Relator name')
    parser.add_argument('-oj', '--orgao', help='Judging body (ex: "9ª Turma")')
    parser.add_argument('-c', '--classe', help='Case class')
    parser.add_argument('-n', '--numero', help='Process number')
    parser.add_argument('-e', '--ementa', help='Text to search in ementa')
    parser.add_argument('-b', '--base', type=int, default=0,
                        help='Database: 0=TRF3, 1=Turmas Recursais, 2=Monocraticas')
    parser.add_argument('-rpp', '--results-per-page', type=int, default=10,
                        help='Results per page: 10, 30, or 50')
    parser.add_argument('-m', '--max-pages', type=int, default=10,
                        help='Maximum pages to crawl')
    parser.add_argument('-o', '--output', default='results-trf3.json',
                        help='Output JSON file')
    parser.add_argument('--headed', action='store_true',
                        help='Show browser window for debugging')
    parser.add_argument('--json', action='store_true',
                        help='Quiet mode: suppress logs, output JSON summary only')

    args = parser.parse_args()

    json_mode = args.json
    log = (lambda *a: None) if json_mode else print

    base_names = {0: 'TRF3', 1: 'Turmas Recursais', 2: 'Monocráticas'}

    log('=' * 60)
    log('TRF3 Jurisprudencia Crawler (DrissionPage)')
    log('=' * 60)
    log(f'Query: {args.query}')
    log(f'Data Inicio: {args.data_inicio or "not set"}')
    log(f'Data Fim: {args.data_fim or "not set"}')
    log(f'Tipo Data: {args.tipo_data}')
    log(f'Relator: {args.relator or "not set"}')
    log(f'Orgao Julgador: {args.orgao or "not set"}')
    log(f'Classe: {args.classe or "not set"}')
    log(f'Numero Processo: {args.numero or "not set"}')
    log(f'Ementa: {args.ementa or "not set"}')
    log(f'Base: {base_names.get(args.base, args.base)}')
    log(f'Resultados por Pagina: {args.results_per_page}')
    log(f'Max Pages: {args.max_pages}')
    log(f'Output: {args.output}')
    log(f'Headless: {not args.headed}')
    log('=' * 60)

    crawler = TRF3Crawler(headless=not args.headed, base=args.base)

    try:
        filters = {
            'numeroProcesso': args.numero,
            'relator': args.relator,
            'dataInicio': args.data_inicio,
            'dataFim': args.data_fim,
            'tipoData': args.tipo_data,
            'classe': args.classe,
            'orgaoJulgador': args.orgao,
            'ementa': args.ementa,
            'resultadosPorPagina': args.results_per_page,
        }

        results = crawler.search(args.query, filters, max_pages=args.max_pages)

        log('=' * 60)
        log(f'Total results collected: {len(results)}')

        with open(args.output, 'w', encoding='utf-8') as f:
            json.dump(results, f, ensure_ascii=False, indent=2)
        log(f'Results saved to: {args.output}')

        if json_mode:
            print(json.dumps({
                'success': True,
                'count': len(results),
                'output': args.output
            }))
    except Exception as e:
        if json_mode:
            print(json.dumps({'success': False, 'error': str(e)}))
            sys.exit(1)
        print(f'Error during crawling: {e}', file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
