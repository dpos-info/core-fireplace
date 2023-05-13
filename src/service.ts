import { Identities, Interfaces, Managers, Transactions, Utils } from "@solar-network/crypto";
import { Container, Contracts, Enums as AppEnums, Providers } from "@solar-network/kernel";

@Container.injectable()
export class Fireplace {
    @Container.inject(Container.Identifiers.PluginConfiguration)
    @Container.tagged("plugin", "@dpos-info/core-fireplace")
    private readonly configuration!: Providers.PluginConfiguration;

    @Container.inject(Container.Identifiers.WalletRepository)
    @Container.tagged("state", "blockchain")
    private readonly walletRepository!: Contracts.State.WalletRepository;

    @Container.inject(Container.Identifiers.EventDispatcherService)
    private readonly events!: Contracts.Kernel.EventDispatcher;

    @Container.inject(Container.Identifiers.LogService)
    private readonly logger!: Contracts.Kernel.Logger;

    @Container.inject(Container.Identifiers.PeerTransactionBroadcaster)
    private readonly transactionBroadcaster!: Contracts.P2P.TransactionBroadcaster;

    private nonce: Utils.BigNumber | undefined;

    private address!: string;
    private passphrase!: string;

    private dust!: Utils.BigNumber;

    public async boot(): Promise<void> {
        this.passphrase = this.configuration.get("passphrase")!;
        this.address = Identities.Address.fromPassphrase(this.passphrase);

        // TODO check for outstanding transactions instead of blindly taking the balance
        this.dust = this.walletRepository.findByAddress(this.address).getBalance();

        this.events.listen(AppEnums.BlockEvent.Applied, {
            handle: () => (this.nonce = undefined),
        });

        this.events.listen(AppEnums.TransactionEvent.Applied, {
            handle: async (data) => this.burn(data),
        });
    }

    private async burn({ data }: { data: Interfaces.ITransactionData }): Promise<void> {
        const transfers =
            data.recipientId === this.address
                ? [
                      {
                          amount: data.amount,
                          recipientId: data.recipientId,
                      },
                  ]
                : data.asset?.transfers?.filter((item) => item.recipientId === this.address);

        if (!transfers || transfers.length === 0) {
            return;
        }

        const milestone = Managers.configManager.getMilestone();
        const minimumBurnAmount = Utils.BigNumber.make(milestone.burn.txAmount);

        const senderWallet = this.walletRepository.findByAddress(this.address);

        let amount = Utils.BigNumber.ZERO;

        for (const transfer of transfers) {
            amount = amount.plus(transfer.amount);
        }

        if (amount.isLessThan(minimumBurnAmount)) {
            this.log(
                `amount of transaction ${data.id!} is too low (${Utils.formatSatoshi(amount)} < ${Utils.formatSatoshi(
                    minimumBurnAmount,
                )})`,
            );

            this.dust = this.dust.plus(amount);

            if (this.dust.isGreaterThanEqual(minimumBurnAmount)) {
                this.nonce = this.nonce ? this.nonce.plus(1) : senderWallet.getNonce().plus(1);

                const transaction = Transactions.BuilderFactory.burn()
                    .amount(this.dust.toString())
                    .memo("dust")
                    .nonce(this.nonce.toString())
                    .sign(this.passphrase)
                    .build();

                this.log(`broadcasting burn transaction for accumulated dust (${Utils.formatSatoshi(this.dust)})`);

                await this.transactionBroadcaster.broadcastTransactions([transaction]);

                this.dust = Utils.BigNumber.ZERO;
            }

            return;
        }

        this.nonce = this.nonce ? this.nonce.plus(1) : senderWallet.getNonce().plus(1);

        const transaction = Transactions.BuilderFactory.burn()
            .amount(amount.toString())
            .memo(data.id!)
            .nonce(this.nonce.toString())
            .sign(this.passphrase)
            .build();

        this.log(`broadcasting burn transaction for transaction with id ${data.id!}`);

        await this.transactionBroadcaster.broadcastTransactions([transaction]);
    }

    private log(message: string) {
        this.logger.info(`[@dpos-info/core-fireplace] ${message}`);
    }
}
