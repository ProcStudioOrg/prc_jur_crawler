define(function (require) {
    var $ = require('jquery');
    var ko = require('knockout-es5');
    var datas = require('js/datas');
    var util = require('js/util');
    var uriUtil = require('js/uri-util');
    var ui = require('js/ui');
    var bindData = require('js/bind-data-hora');
    var tj = require('servicos/tj');
    var publicoService = require('servicos/publicoService');
    var captcha = require('componentes/captcha/captcha');

    function ViewModel(params) {
        var self = {};

        self.classes = null;
        self.origens = null;
        self.relatores = null;
        self.secretarias = null;
        self.valorPadrao = true;
        self.orgaoDefault = "0";
        self.linkConsultaProcesso = '../consultar-processo/consultar-processo.html?numero_unico=';
        self.linkConsultaDJE = 'http://app.tjap.jus.br/tucujuris/publico/dje/?data=';
        // self.linkConsultaDJE ='../consultar-dje/consultar-dje.html?dataDivulgacao=';
        self.resultado = undefined;
        self.exibirDetalhe = false;
        self.textoDetalhe = undefined;
        self.exibeBotaoMais = false;
        self.numeroAcordaoTab = undefined;
        self.consultaExtrajudicial = false;

        // data da ultima atualização do banco de jurisprudencia retornado na consulta
        self.dataBancoJurisprudencia = null;

        self.filtro = {
            orgao: "0",
            numeroCNJ: undefined,
            ementa: undefined,
            numeroAcordao: undefined,
            numeroAno: undefined,
            palavrasExatas: undefined,
            relator: undefined,
            secretaria: undefined,
            classe: undefined,
            votacao: undefined,
            origem: undefined,
            offset: undefined,
            tipo_jurisprudencia: undefined,
            captcha: undefined
        };

        self.detalhe = {
            acordao: undefined,
            ementa: undefined,
            id: undefined,
            relator: undefined,
            origem_dado: undefined,
            teor: undefined,
            teor_complemento: undefined,
            numeroano: undefined,
            numeroacordao: undefined,
            classe: undefined
        };

        // monta uma lista de 30anos apartir do ano atual 2025,2024,2023,2022...
        self.anosJurisprudencia = (new Array(30)).fill(0).map((_, index) => (new Date()).getFullYear() - index);


        // guarda info do captcha gerado para poder reseta-lo e deixa-lo
        // pronto para o uso a cada consulta
        self.captchaInfo = {
            id: null,
            passe: null,
            requerido: null
        };

        self.captchaCallback = function (resposta) {
            self.filtro.captcha = resposta;
        };

        self._resetarCaptcha = function () {
            // a cada consulta realizada um novo captcha é gerado
            // então ao resetar o captcha limpa o valor já utilizado
            if (self.filtro && self.filtro.captcha) {
                self.filtro.captcha = undefined;
            }

            // a cada reset um novo passe é gerado
            // e deve ser usado na proxima consulta
            captcha.reset(self.captchaInfo.id)
                .then(function (info) {
                    self.captchaInfo.passe = info.passe;
                });
        };


        self.selecionarTexto = function (cite) {
            var sel, range;
            var el = cite;
            if (window.getSelection && document.createRange) {
                sel = window.getSelection();
                if (sel.toString() == '') {
                    window.setTimeout(function () {
                        range = document.createRange();
                        range.selectNodeContents(el);
                        sel.removeAllRanges();
                        sel.addRange(range);
                    }, 1);
                }
            } else if (document.selection) {
                sel = document.selection.createRange();
                if (sel.text == '') {
                    range = document.body.createTextRange();
                    range.moveToElementText(el);
                    range.select();
                }
            }
        };

        self.init = function () {
            self.filtro.tipo_jurisprudencia = uriUtil.queryString('tipo_jurisprudencia');
            self.consultaExtrajudicial = self.filtro.tipo_jurisprudencia && self.filtro.tipo_jurisprudencia == 99;
            publicoService.carregarFiltrosComboJurisprudencia()
                .done(function (dados) {
                    self.classes = dados.classes;
                    self.origens = dados.origens;
                    self.relatores = dados.relatores;
                    self.secretarias = dados.secretarias;
                })
                .fail(function (erro) {
                    console.log(erro);
                    ui.alertar(erro);
                });

            publicoService.buscarDataUltimaAtualizacaoBancoJurisprudencia()
                .done(function (dados) {
                    self.dataBancoJurisprudencia = dados;
                })
                .fail(function (erro) {
                    console.log(erro);
                });

            $(".consulta-jurisprudencia-page").on("click", ".btn-link", function (e) {
                e.preventDefault();
                var link = e.target;

                var cite = $(link).parent().next("blockquote").find("cite");
                self.selecionarTexto(cite[0]);
            });
            $("#numeroAcordao").keypress(function (e) {
                //if the letter is not digit then display error and don't type anything
                if (e.which != 8 && e.which != 0 && (e.which < 48 || e.which > 57)) {
                    return false;
                }
            });
        };

        self.consultar = function () {
            ui.desabilitar("#btPesquisar", "pesquisando...");
            publicoService.consultarJurisprudencia(self.filtro)
                .done(function (dados) {
                    if (dados) {
                        self.resultado = (dados || []).map(self.mapResultadoConsulta);
                        $('.nav-tabs a[href="#resultado"]').tab('show');
                    } else {
                        $('.nav-tabs a[href="#filtro"]').tab('show');
                    }
                    self.exibeBotaoMais = self.resultado && self.resultado.length >= 20;

                    self.ajustarFocoPagina();
                })
                .fail(function (erro) {
                    console.log(erro);
                    ui.alertar(erro);
                })
                .always(function () {
                    ui.habilitar("#btPesquisar");
                });
        };


        self._tentarUsarRegex = function (regex) {
            var output = null;

            try {
                output = new RegExp(regex, 'gi');
            } catch (erro) {
                console.log('Opa seu navegador não suporta expressões regulares', erro);
            }

            return output;
        };

        self.downloadRegistroJurisprudenciaDaLista = function (registro) {
            return self.downloadRegistroJurisprudencia(registro.identificador);
        };

        self.downloadRegistroJurisprudencia = function (id, formato = 'pdf') {
            ui.notificar('Preparando o download');
            return publicoService.downloadRegistroJurisprudencia(id, formato);
        };

        self.mapResultadoConsulta = function (item) {
            item.datapublicacaoext = item.datapublicacao ? datas.formatar(item.datapublicacao, 'LL') : null;
            item.datapublicacao = item.datapublicacao ? datas.formatar(item.datapublicacao, 'L') : null;
            item.textoementaref = undefined;
            if (self.filtro.ementa) {
                var lista = self.filtro.ementa.split(" ");

                lista = lista.filter(function (item) {
                    return !["da", "das", "dal", "de", "des", "del", "do", "dos", "na", "nas", "no", "nos", "e"].includes(String(item).toLowerCase());
                });

                var regex = self._tentarUsarRegex(/"/);

                if (regex) {
                    lista = lista.map(function (elemento) {
                        return elemento.replace(regex, "").trim();
                    });
                }

                //highlight do termo pesquisado
                for (var i = 0; i < lista.length; i++) {
                    var regex = "";
                    if (lista[i].length <= 2) {
                        regex = self._tentarUsarRegex("(\\b\\s" + lista[i] + "\\b\\s)");
                    } else {
                        regex = self._tentarUsarRegex("(" + lista[i] + ")");
                    }
                    if (regex) {
                        item.textoementa = item.textoementa.replace(regex, '<span style="color:red">$1</span>');
                    }
                }
                item.textoementa = "<p>" + item.textoementa + "</p>";
                var referencia = "<br /> (" + (item.classe || '') + (item.numeroano ? ". Processo Nº " + item.numeroano : '')
                    + (item.nomerelator ? ", Relator " + item.nomerelator : '')
                    + ", " + (item.lotacao ? item.lotacao : '')
                    + (item.datajulgamento ? ", julgado em " + datas.formatar(item.datajulgamento, 'LL') : '')
                    + (item.numeropublicacao ? ", publicado no DOE Nº " + item.numeropublicacao : '')
                    + (item.datapublicacaoext ? " em " + item.datapublicacaoext : '') + ")";
                item.textoementaref = item.textoementa + referencia;
            }
            return item;
        }

        self.consultarDetalhe = function (processoSelecionado) {
            ui.desabilitar("#btMostrarDetalhe-" + processoSelecionado.numeroacordao, "carregando...");
            publicoService.consultarDetalheJurisprudencia({
                'id': processoSelecionado.id,
                'identificador': processoSelecionado.identificador,
                'origem': processoSelecionado.origemdado
            })
                .done(function (dados) {
                    if (dados) {
                        //recomendavel fazer todas as modificacoes em outro objeto antes de passar para o observavel.
                        // caso contrario, as alteracoes podem nao ser refletidas no observavel
                        dados.numeroacordao = processoSelecionado.numeroacordao;
                        dados.relator = processoSelecionado.nomerelator;
                        dados.numeroano = processoSelecionado.numeroano;
                        dados.classe = processoSelecionado.classe;

                        self.detalhe = dados;

                        self.exibirDetalhe = true;
                        self.textoDetalhe = self.detalhe.id;
                        self.numeroAcordaoTab = dados.numeroacordao;

                        $('.nav-tabs a[href="#detalhe"]').tab('show');
                        self.ajustarFocoPagina();
                    } else {
                        $('.nav-tabs a[href="#resultado"]').tab('show');
                    }
                })
                .fail(function (erro) {
                    console.log(erro);
                    ui.alertar(erro);
                })
                .always(function () {
                    ui.habilitar("#btMostrarDetalhe-" + processoSelecionado.numeroacordao);
                });

        };

        self.exibirMaisOpcoes = function () {
            $("#avancado").removeClass("hide");
            $("#maisOpcoes").hide();
        };

        self.limpar = function () {
            $("#avancado").addClass("hide");
            $("#maisOpcoes").show();
            $("#formPesquisa").trigger('reset');
            self.filtro = {
                orgao: "0",
                numeroCNJ: undefined,
                ementa: undefined,
                numeroAcordao: undefined,
                numeroAno: undefined,
                palavrasExatas: undefined,
                relator: undefined,
                secretaria: undefined,
                classe: undefined,
                votacao: undefined,
                origem: undefined,
                offset: undefined,
                tipo_jurisprudencia: undefined
            };

            self.detalhe = {
                acordao: undefined,
                ementa: undefined,
                id: undefined,
                relator: undefined,
                origem_dado: undefined,
                teor: undefined,
                teor_complemento: undefined,
                numeroano: undefined,
                numeroacordao: undefined,
                classe: undefined
            };
        };

        self.ajustarFocoPagina = function () {
            var el = document.getElementById("titulo-pagina");
            el.scrollIntoView();
        };


        self.maisResultados = function () {
            ui.desabilitar("#btMaisResultados", "carregando...");
            if (self.filtro.offset == undefined) {
                self.filtro.offset = 20;
            }
            publicoService.consultarJurisprudencia(self.filtro)
                .done(function (dados) {
                    if (dados) {
                        var auxResultado = self.resultado;
                        dados.map(self.mapResultadoConsulta);
                        (dados || []).forEach(function (item) {
                            auxResultado.push(item);
                        });
                        self.resultado = auxResultado;
                        self.filtro.offset += 20;
                        self.exibeBotaoMais = self.resultado && self.resultado.length >= 20;
                    }
                })
                .fail(function (erro) {
                    console.log(erro);
                    ui.alertar(erro);
                })
                .always(function () {
                    ui.habilitar("#btMaisResultados");
                });

        };

        self.init();
        ko.track(self);
        window.vm = self;
        return self;
    }

    ko.applyBindings(ViewModel);
});





//# sourceMappingURL=consultar-jurisprudencia.js.map
