import { Providers } from "@solar-network/kernel";

import { Fireplace } from "./service";

export class ServiceProvider extends Providers.ServiceProvider {
    private service = Symbol.for("Service<Fireplace>");

    public async register(): Promise<void> {
        if (this.config().get("enabled")) {
            this.app.bind<Fireplace>(this.service).to(Fireplace).inSingletonScope();
        }
    }

    public async bootWhen(): Promise<boolean> {
        return !!this.config().get("enabled") && !!this.config().get("passphrase");
    }

    public async boot(): Promise<void> {
        this.app.get<Fireplace>(this.service).boot();
    }
}
